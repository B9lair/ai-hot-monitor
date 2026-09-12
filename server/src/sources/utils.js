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
  return {
    title: String(item.title || '').trim(),
    url: String(item.url || '').trim(),
    snippet: String(item.snippet || '').trim(),
    source: String(item.source || ''),
    publishedAt: item.publishedAt || null,
  };
}

/** 简单延时，避免频繁抓取被封 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
