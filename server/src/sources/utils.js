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
  // 质量指标：供第二层过滤/排序使用，并由 monitor 入库（metrics 字段）
  if (item.metrics) out.metrics = item.metrics;
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
  if (source === 'Twitter') {
    return Math.min((m.score || 0) * 2, 100);
  }
  if (source === 'GitHub') {
    return Math.min(Math.log10(1 + (m.stars || 0)) * 20 + Math.log10(1 + (m.forks || 0)) * 10, 100);
  }
  if (source === 'HackerNews') {
    return Math.min(Math.log10(1 + (m.points || 0)) * 20 + Math.log10(1 + (m.comments || 0)) * 5, 100);
  }
  if (source === 'B站') {
    return m.views ? Math.min(Math.log10(1 + m.views) * 15, 100) : null;
  }
  return null;
}

/** 简单延时，避免频繁抓取被封 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
