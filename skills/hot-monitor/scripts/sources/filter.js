/**
 * 分层过滤：第一层（基础）+ 第二层（质量）
 * 第三层（AI 深度分析：真假识别 + 相关性评分）在 ahm.js 主流程
 *
 * 原则：采集阶段尽量拓宽范围、不过早过滤；过滤按层依次进行。
 */
import { computeHotScore } from './utils.js';

/**
 * 第一层 · 基础过滤：格式校验 + URL 去重 + 时间窗口
 * @param {Array} items 各源原始条目
 * @param {object} s config.sources
 */
export function applyBasicFilter(items, s) {
  const now = Date.now();
  const defaultHours = Math.max(0, Number(s.timeWindowHours) || 0);
  const bySource = s.timeWindowBySource || {};
  const seen = new Set();
  const out = [];

  for (const it of items) {
    if (!it.title || !it.url) continue;
    if (seen.has(it.url)) continue;
    const hours = Math.max(0, Number(bySource[it.source] ?? defaultHours) || 0);
    if (hours > 0 && it.publishedAt) {
      const t = new Date(it.publishedAt).getTime();
      if (Number.isFinite(t) && now - t > hours * 3600 * 1000) continue;
    }
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

/**
 * 第二层 · 质量过滤：社交指标 + 作者信誉，并施加每源保留上限
 * @param {Array} items 已过第一层的条目
 * @param {object} s config.sources（可覆盖 perSourceLimit）
 */
export function applyQualityFilter(items, s) {
  const twitter = [];
  const others = [];
  for (const it of items) (it.source === 'Twitter' ? twitter : others).push(it);

  const m = (i) => i.metrics || {};
  const hasEngagement = twitter.some(
    (i) => (m(i).likes || 0) > 0 || (m(i).retweets || 0) > 0 || (m(i).views || 0) > 0,
  );

  const twKept = hasEngagement
    ? twitter.filter(
        (i) =>
          (m(i).likes || 0) >= s.twitterMinLikes &&
          (m(i).retweets || 0) >= s.twitterMinRetweets &&
          (m(i).views || 0) >= s.twitterMinViews &&
          (m(i).followers || 0) >= s.twitterMinFollowers,
      )
    : twitter;
  twKept.sort((a, b) => (m(b).score || 0) - (m(a).score || 0));

  const groups = new Map();
  for (const it of others) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  const ranked = [];
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        (computeHotScore(b.source, b.metrics) ?? -1) - (computeHotScore(a.source, a.metrics) ?? -1),
    );
    ranked.push(...list);
  }

  const minHot = Number(s.minHotScore) || 0;
  const keep = Math.max(1, Number(s.perSourceLimit) || 8);
  const count = new Map();
  const out = [];
  for (const it of [...twKept, ...ranked]) {
    if (it.source !== 'Twitter' && minHot > 0) {
      const hs = computeHotScore(it.source, it.metrics);
      if (hs !== null && hs < minHot) continue;
    }
    const n = (count.get(it.source) || 0) + 1;
    count.set(it.source, n);
    if (n <= keep) out.push(it);
  }
  return out;
}
