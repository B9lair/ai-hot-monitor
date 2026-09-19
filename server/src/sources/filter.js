/**
 * 分层过滤：第一层（基础）+ 第二层（质量）
 * 第三层（AI 深度分析：真假识别 + 相关性评分）在 services/monitor.js
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
    // 格式校验
    if (!it.title || !it.url) continue;
    // URL 去重
    if (seen.has(it.url)) continue;
    // 时间窗口：按源差异化；无发布时间的条目放行（避免误杀缺少该字段的源）
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
  // 互动数据整体缺失时降级：不做门槛过滤，避免误杀
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
  // 蓝V加权后的综合分降序
  twKept.sort((a, b) => (m(b).score || 0) - (m(a).score || 0));

  // 非 Twitter 源：按源分组 → 组内按 hotScore 降序（有热度排前，无热度排后）
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

  // 可选全局热度门槛（默认 0 = 关闭）：仅过滤「有 hotScore 且低于门槛」的条目；
  // 搜索引擎无 hotScore（null）不受影响，仍靠语义相关性保留
  const minHot = Number(s.minHotScore) || 0;

  // 每源保留上限（Twitter 已按 score 排序，其余已按 hotScore 排序）
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
