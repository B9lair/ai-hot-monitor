/**
 * 分层过滤：第一层（基础）+ 第二层（质量）
 * 第三层（AI 深度分析：真假识别 + 相关性评分）在 services/monitor.js
 *
 * 原则：采集阶段尽量拓宽范围、不过早过滤；过滤按层依次进行。
 */

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

  // 每源保留上限（Twitter 已按热度排序，其余保持源内原顺序）
  const keep = Math.max(1, Number(s.perSourceLimit) || 8);
  const count = new Map();
  const out = [];
  for (const it of [...twKept, ...others]) {
    const n = (count.get(it.source) || 0) + 1;
    count.set(it.source, n);
    if (n <= keep) out.push(it);
  }
  return out;
}
