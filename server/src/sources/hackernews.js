import { config } from '../config.js';
import { http, normalize } from './utils.js';

/**
 * Hacker News 搜索（使用 Algolia 官方 API，无需 key）
 *
 * 注意：Algolia 默认按「相关度 + 热度」排序，返回的往往是几个月前的老热帖。
 * 因此把第一层时间窗口下推到接口（`numericFilters=created_at_i>since`），
 * 直接只取窗口内的内容，避免"采集 20 条后被时间窗口全部丢弃"。
 */
export async function searchHackerNews(query, limit = 20) {
  const s = config.sources;
  const hours = s.timeWindowBySource?.HackerNews ?? s.timeWindowHours;
  const since = Math.floor(Date.now() / 1000) - Math.max(1, hours) * 3600;

  const res = await http.get('https://hn.algolia.com/api/v1/search', {
    params: {
      query,
      hitsPerPage: limit,
      tags: 'story',
      numericFilters: `created_at_i>${since}`,
    },
  });
  const hits = res.data?.hits || [];
  return hits
    .map((h) =>
      normalize({
        title: h.title || h.story_title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: h.story_text ? String(h.story_text).slice(0, 200) : '',
        source: 'HackerNews',
        publishedAt: h.created_at ? new Date(h.created_at) : null,
        // 热度指标：点数 / 评论数（供综合热度分计算）
        metrics: { points: h.points || 0, comments: h.num_comments || 0 },
      }),
    )
    .filter((i) => i.title);
}
