import { searchHackerNews } from './hackernews.js';
import { searchMultiEngines } from './websearch.js';
import { searchTwitter } from './twitter.js';
import { searchBilibili, getBilibiliHot } from './bilibili.js';
import { getWeiboHot } from './weibo.js';

/**
 * 关键词搜索：从多个信息源抓取与关键词相关的最新内容
 * @param {string} keyword
 * @param {number} limit 每个源的条数
 */
export async function searchAll(keyword, limit = 10) {
  const tasks = [
    { name: 'twitter', run: () => searchTwitter(keyword, limit) },
    { name: 'hackernews', run: () => searchHackerNews(keyword, limit) },
    { name: 'bilibili', run: () => searchBilibili(keyword, limit) },
    { name: 'web', run: () => searchMultiEngines(keyword, ['bing', 'duckduckgo', 'sogou'], limit) },
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      items.push(...r.value);
    }
  });

  // 按 URL 去重
  const seen = new Set();
  return items.filter((it) => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}

/**
 * 热点发现：从各大榜单 + 搜索抓取指定范围的热点
 * @param {string} topic
 * @param {number} limit
 */
export async function discoverAll(topic, limit = 10) {
  const tasks = [
    { name: 'weibo', run: () => getWeiboHot(limit) },
    { name: 'bilibili', run: () => getBilibiliHot(limit) },
    { name: 'hackernews', run: () => searchHackerNews(topic, limit) },
    { name: 'twitter', run: () => searchTwitter(topic, limit) },
    { name: 'web', run: () => searchMultiEngines(topic, ['bing', 'duckduckgo', 'sogou'], limit) },
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const items = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      items.push(...r.value);
    }
  });

  const seen = new Set();
  return items.filter((it) => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}
