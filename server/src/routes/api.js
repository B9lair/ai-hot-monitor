import { Router } from 'express';
import { prisma } from '../db.js';
import { runMonitor } from '../services/monitor.js';
import { broadcastMonitorProgress } from '../socket.js';
import { hasAI, hasSMTP, config } from '../config.js';

const router = Router();

// 可直接下推 Prisma orderBy 的排序字段
const DIRECT_SORTS = ['createdAt', 'publishedAt', 'confidence', 'hotScore', 'relevance'];

/** 动态/JSON 指标排序（trending 智能热榜分 / likes / stars），缺失值统一排最后 */
function applyCustomSort(list, sort, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const val = (a) => {
    if (sort === 'trending') {
      if (a.hotScore == null) return null;
      const ageHours = (Date.now() - new Date(a.createdAt).getTime()) / 3600000;
      return a.hotScore / Math.pow(Math.max(0, ageHours) + 2, 1.5);
    }
    let metrics = {};
    try {
      metrics = a.metrics ? JSON.parse(a.metrics) : {};
    } catch {
      metrics = {};
    }
    const key = sort === 'likes' ? 'likes' : 'stars';
    const n = Number(metrics[key]);
    return Number.isFinite(n) ? n : null;
  };
  return list.slice().sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const na = va == null;
    const nb = vb == null;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return (va - vb) * sign;
  });
}

// ===== 关键词 CRUD =====
router.get('/keywords', async (_req, res) => {
  const list = await prisma.keyword.findMany({
    orderBy: { createdAt: 'desc' },
    include: { alerts: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  res.json(list);
});

router.post('/keywords', async (req, res) => {
  const { text, intervalMin } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '关键词不能为空' });
  const kw = await prisma.keyword.upsert({
    where: { text: text.trim() },
    update: { enabled: true, intervalMin: intervalMin || 5 },
    create: { text: text.trim(), intervalMin: intervalMin || 5 },
  });
  res.json(kw);
});

router.patch('/keywords/:id', async (req, res) => {
  const { id } = req.params;
  const { enabled, intervalMin } = req.body || {};
  const data = {};
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (intervalMin) data.intervalMin = intervalMin;
  const kw = await prisma.keyword.update({ where: { id }, data });
  res.json(kw);
});

router.delete('/keywords/:id', async (req, res) => {
  await prisma.keyword.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// 立即执行一次关键词监控（执行期间通过 Socket.io 广播校验进度）
router.post('/keywords/:id/run', async (req, res) => {
  const kw = await prisma.keyword.findUnique({ where: { id: req.params.id } });
  if (!kw) return res.status(404).json({ error: '关键词不存在' });
  const result = await runMonitor(kw, (p) => {
    broadcastMonitorProgress({ keywordId: kw.id, keyword: kw.text, ...p });
  });
  res.json(result);
});

// ===== 查询：命中 / 通知 =====
// GET /api/alerts?source=&isFake=&keywordId=&from=&to=&minConfidence=&maxConfidence=
//                &minHot=&maxHot=&q=&sort=&order=&page=&pageSize=
// 响应：{ list, total, page, pageSize, totalPages }
router.get('/alerts', async (req, res) => {
  const {
    source,
    isFake,
    keywordId,
    from,
    to,
    minConfidence,
    maxConfidence,
    minHot,
    maxHot,
    q,
    sort = 'createdAt',
    order = 'desc',
    page = '1',
    pageSize = '20',
  } = req.query;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dt = (v) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const where = {};
  if (source) where.source = source;
  if (isFake === 'true' || isFake === 'false') where.isFake = isFake === 'true';
  if (keywordId) where.keywordId = keywordId;

  if (from || to) {
    const range = {};
    const f = dt(from);
    const t = dt(to);
    if (f) range.gte = f;
    if (t) range.lte = t;
    if (Object.keys(range).length) where.createdAt = range;
  }

  const cMin = num(minConfidence);
  const cMax = num(maxConfidence);
  if (cMin != null || cMax != null) {
    const range = {};
    if (cMin != null) range.gte = cMin;
    if (cMax != null) range.lte = cMax;
    where.confidence = range;
  }

  const hMin = num(minHot);
  const hMax = num(maxHot);
  if (hMin != null || hMax != null) {
    const range = {};
    if (hMin != null) range.gte = hMin;
    if (hMax != null) range.lte = hMax;
    where.hotScore = range;
  }

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { snippet: { contains: q } },
      { summary: { contains: q } },
    ];
  }

  const dir = order === 'asc' ? 'asc' : 'desc';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const skip = (pageNum - 1) * size;

  let list;
  let total;

  if (DIRECT_SORTS.includes(sort)) {
    total = await prisma.alert.count({ where });
    // createdAt 非空，直接用字符串排序；其余可空字段用 nulls: 'last'（缺失值排最后）
    const orderBy =
      sort === 'createdAt'
        ? [{ createdAt: dir }]
        : [{ [sort]: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' }];
    list = await prisma.alert.findMany({
      where,
      orderBy,
      skip,
      take: size,
      include: { keyword: { select: { text: true } } },
    });
  } else {
    // 应用层排序（trending/likes/stars）：先全量查出、排序后再分页
    const all = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { keyword: { select: { text: true } } },
    });
    total = all.length;
    list = applyCustomSort(all, sort, dir).slice(skip, skip + size);
  }

  res.json({ list, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) });
});

// ===== KPI 统计（全局，不受分页/筛选影响） =====
router.get('/stats', async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [realAlerts, fakeAlerts, todayAlerts, enabledKeywords] = await Promise.all([
    prisma.alert.count({ where: { isFake: false } }),
    prisma.alert.count({ where: { isFake: true } }),
    prisma.alert.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.keyword.count({ where: { enabled: true } }),
  ]);
  res.json({ realAlerts, fakeAlerts, todayAlerts, enabledKeywords });
});

router.get('/notifications', async (_req, res) => {
  const list = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(list);
});

// ===== 状态 =====
router.get('/status', (_req, res) => {
  const en = config.sources.enabled;
  res.json({
    hasAI: hasAI(),
    hasSMTP: hasSMTP(),
    model: config.openrouter.model,
    judgeModel: config.openrouter.judgeModel || config.openrouter.model,
    relevanceThreshold: config.openrouter.relevanceThreshold,
    intervals: config.intervals,
    sources: {
      twitter: Boolean(config.sources.twitterApiKey) && en.twitter,
      hackernews: en.hackernews,
      bilibili: en.bilibili,
      weibo: en.weibo,
      weiboSearch: en.weibo && Boolean(config.sources.weiboCookie),
      bing: en.bing,
      sogou: en.sogou,
      baidu: en.baidu,
      google: en.google,
      duckduckgo: en.duckduckgo,
      github: en.github,
      zhihu: en.zhihu && Boolean(config.sources.zhihuCookie),
      reddit: en.reddit,
      v2ex: en.v2ex,
    },
  });
});

export default router;
