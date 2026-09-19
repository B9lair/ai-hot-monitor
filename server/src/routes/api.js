import { Router } from 'express';
import { prisma } from '../db.js';
import { runMonitor } from '../services/monitor.js';
import { sendAlertEmails } from '../services/email.js';
import { broadcastMonitorProgress } from '../socket.js';
import { hasAI, hasSMTP, config } from '../config.js';

const router = Router();

// 可直接下推 Prisma orderBy 的排序字段
const DIRECT_SORTS = ['createdAt', 'publishedAt', 'confidence', 'hotScore', 'relevance', 'favoritedAt'];

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

// 立即执行一次关键词监控（进度定向推送给发起人；结果邮件聚合发送给发起人）
router.post('/keywords/:id/run', async (req, res) => {
  const kw = await prisma.keyword.findUnique({ where: { id: req.params.id } });
  if (!kw) return res.status(404).json({ error: '关键词不存在' });
  const userId = req.session?.userId;
  const result = await runMonitor(kw, (p) => {
    broadcastMonitorProgress({ keywordId: kw.id, keyword: kw.text, ...p });
  });

  if (config.email.mode === 'digest' && result.alerts?.length) {
    try {
      await sendAlertEmails(result.alerts, {
        batchKey: `digest:manual:${Date.now()}`,
        userIds: userId ? [userId] : undefined,
      });
    } catch (err) {
      console.error('[api] 手动检查邮件发送失败:', err.message);
    }
  }

  const { alerts, ...payload } = result;
  res.json(payload);
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
    includeHidden,
    favoriteId,
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

  const where = { AND: [] };
  const and = where.AND;

  if (source) and.push({ source });
  if (isFake === 'true' || isFake === 'false') and.push({ isFake: isFake === 'true' });
  if (keywordId) and.push({ keywordId });
  if (favoriteId) and.push({ favoriteId });

  if (from || to) {
    const range = {};
    const f = dt(from);
    const t = dt(to);
    if (f) range.gte = f;
    if (t) range.lte = t;
    if (Object.keys(range).length) and.push({ createdAt: range });
  }

  const cMin = num(minConfidence);
  const cMax = num(maxConfidence);
  if (cMin != null || cMax != null) {
    const range = {};
    if (cMin != null) range.gte = cMin;
    if (cMax != null) range.lte = cMax;
    and.push({ confidence: range });
  }

  const hMin = num(minHot);
  const hMax = num(maxHot);
  if (hMin != null || hMax != null) {
    const range = {};
    if (hMin != null) range.gte = hMin;
    if (hMax != null) range.lte = hMax;
    and.push({ hotScore: range });
  }

  if (q) {
    and.push({
      OR: [
        { title: { contains: q } },
        { snippet: { contains: q } },
        { summary: { contains: q } },
      ],
    });
  }

  // 信息生命周期：默认隐藏「超 N 天且未收藏」的内容；includeHidden=true 显示全部
  if (includeHidden !== 'true') {
    const ttlAgo = new Date(Date.now() - config.alertTtlDays * 86400 * 1000);
    and.push({ OR: [{ createdAt: { gte: ttlAgo } }, { favoriteId: { not: null } }] });
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

router.get('/notifications', async (req, res) => {
  const list = await prisma.notification.findMany({
    // 本人通知 + 历史全局通知（userId 为空）
    where: { OR: [{ userId: req.session?.userId || null }, { userId: null }] },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(list);
});

// ===== 收藏夹 =====
async function ensureDefaultFavorite() {
  const existing = await prisma.favorite.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  return prisma.favorite.create({ data: { name: '默认收藏夹', isDefault: true } });
}

router.get('/favorites', async (_req, res) => {
  await ensureDefaultFavorite();
  const list = await prisma.favorite.findMany({
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { alerts: true } } },
  });
  res.json(list);
});

router.post('/favorites', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '收藏夹名称不能为空' });
  res.json(await prisma.favorite.create({ data: { name: name.trim() } }));
});

router.patch('/favorites/:id', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '收藏夹名称不能为空' });
  res.json(await prisma.favorite.update({ where: { id: req.params.id }, data: { name: name.trim() } }));
});

router.delete('/favorites/:id', async (req, res) => {
  const fav = await prisma.favorite.findUnique({ where: { id: req.params.id } });
  if (!fav) return res.status(404).json({ error: '收藏夹不存在' });
  if (fav.isDefault) return res.status(400).json({ error: '默认收藏夹不可删除' });
  await prisma.favorite.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// 收藏到指定收藏夹（不传 favoriteId 则收藏到默认收藏夹）
router.post('/alerts/:id/favorite', async (req, res) => {
  const { favoriteId } = req.body || {};
  let targetId = favoriteId;
  if (targetId) {
    const fav = await prisma.favorite.findUnique({ where: { id: targetId } });
    if (!fav) return res.status(400).json({ error: '收藏夹不存在' });
  } else {
    targetId = (await ensureDefaultFavorite()).id;
  }
  const updated = await prisma.alert.update({
    where: { id: req.params.id },
    data: { favoriteId: targetId, favoritedAt: new Date() },
  });
  res.json(updated);
});

// 取消收藏
router.delete('/alerts/:id/favorite', async (req, res) => {
  const updated = await prisma.alert.update({
    where: { id: req.params.id },
    data: { favoriteId: null, favoritedAt: null },
  });
  res.json(updated);
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
