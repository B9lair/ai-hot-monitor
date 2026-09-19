import axios from 'axios';

/** 统一的 UA，避免被反爬 */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 通用 axios 实例 */
export const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json' },
});

/** 标准化条目结构 */
export function normalize(item) {
  const out = {
    title: String(item.title || '').trim(),
    url: String(item.url || '').trim(),
    snippet: String(item.snippet || '').trim(),
    source: String(item.source || ''),
    publishedAt: item.publishedAt || null,
  };
  if (item.author) out.author = String(item.author).trim();
  // 质量指标：供第二层过滤/排序使用，并由 monitor 入库（metrics 字段）。
  // 仅当存在「至少一个正数」或「真值布尔」时才带出，避免写入全零的空指标。
  if (item.metrics && typeof item.metrics === 'object') {
    const usable = Object.values(item.metrics).some(
      (v) => (typeof v === 'number' && v > 0) || (typeof v === 'boolean' && v === true),
    );
    if (usable) out.metrics = item.metrics;
  }
  return out;
}

/**
 * 综合热度分：把各源互动指标归一化到 0~100（对数压缩，避免单一源数值悬殊）。
 * 无指标的源返回 null（排序时排最后）。
 * @param {string} source 数据源标识（如 'Twitter' / 'GitHub' / 'HackerNews' / 'B站'）
 * @param {object} metrics 该条目的互动指标
 */
export function computeHotScore(source, metrics) {
  if (!metrics) return null;
  const m = metrics;
  const log = (n) => Math.log10(1 + Math.max(0, Number(n) || 0));

  if (source === 'Twitter') {
    return Math.min((m.score || 0) * 2, 100);
  }
  if (source === 'GitHub') {
    return Math.min(log(m.stars) * 20 + log(m.forks) * 10 + log(m.watchers) * 5, 100);
  }
  if (source === 'HackerNews') {
    return Math.min(log(m.points) * 20 + log(m.comments) * 5, 100);
  }
  if (source === 'B站') {
    // 富化后：播放 + 赞/投币/收藏/弹幕/评论 加权；未富化仅播放量
    const raw =
      (m.views || 0) +
      (m.likes || 0) * 3 +
      (m.coins || 0) * 5 +
      (m.favorites || 0) * 2 +
      (m.danmaku || 0) +
      (m.comments || 0) * 2;
    return raw > 0 ? Math.min(log(raw) * 15, 100) : null;
  }
  if (source === '微博') {
    const raw = (m.likes || 0) + (m.reposts || 0) * 2 + (m.comments || 0) * 0.5;
    return raw > 0 ? Math.min(log(raw) * 25, 100) : null;
  }
  if (source === '知乎') {
    const raw = (m.likes || 0) + (m.comments || 0) * 0.5;
    return raw > 0 ? Math.min(log(raw) * 25, 100) : null;
  }
  if (source === 'Reddit') {
    const raw = (m.likes || 0) + (m.comments || 0) * 0.5;
    return raw > 0 ? Math.min(log(raw) * 25, 100) : null;
  }
  if (source === 'V2EX') {
    const raw = m.comments || 0;
    return raw > 0 ? Math.min(log(raw) * 30, 100) : null;
  }
  return null;
}

/** 简单延时，避免频繁抓取被封 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析中文缩写计数（如 "1.2万" → 12000、"3.4亿" → 3.4e8、纯数字） */
export function parseChineseCount(text) {
  if (text == null) return 0;
  const m = String(text).trim().replace(/,/g, '').match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return 0;
  if (m[2] === '万') n *= 10000;
  else if (m[2] === '亿') n *= 100000000;
  return n;
}

/**
 * 从文本中尽力解析发布时间（相对时间 / 绝对日期）为 Date；失败返回 null。
 * 支持：yyyy-MM-dd[ HH:mm]、yyyy年M月D日、M月D日、x分钟前/x小时前/x天前、昨天/前天/刚刚。
 */
export function parseRelativeTime(text, now = Date.now()) {
  const s = String(text || '').trim();
  if (!s) return null;
  const base = new Date(now);
  let m;

  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    if (!Number.isNaN(d.getTime())) return d;
  }

  m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  m = s.match(/(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(base.getFullYear(), +m[1] - 1, +m[2], m[3] ? +m[3] : 0, m[4] ? +m[4] : 0);
    if (d.getTime() > now) d.setFullYear(d.getFullYear() - 1);
    return d;
  }

  m = s.match(/(\d+)\s*分钟前/);
  if (m) return new Date(now - +m[1] * 60 * 1000);

  m = s.match(/(\d+)\s*小时前/);
  if (m) return new Date(now - +m[1] * 3600 * 1000);

  m = s.match(/(\d+)\s*天前/);
  if (m) return new Date(now - +m[1] * 86400 * 1000);

  if (/昨天/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (/前天/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() - 2);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (/刚刚|秒前/.test(s)) return new Date(now);

  return null;
}

/** 需要剥离的追踪/来源参数（不影响内容本身的业务参数保留） */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'from', 'ref', 'referrer', 'source', 'spm', 'share_token', 'share_source',
  'ncid', 'weiboauthoruid', 'for', 'via', 'f', 'src',
]);

/** URL 归一化：剥离追踪参数、统一协议、host 小写、去尾部斜杠、去 fragment */
export function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:') u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return String(rawUrl || '');
  }
}
