import { http, normalize } from './utils.js';

/**
 * Hacker News 搜索（使用 Algolia 官方 API，无需 key）
 */
export async function searchHackerNews(query, limit = 20) {
  const res = await http.get('https://hn.algolia.com/api/v1/search', {
    params: { query, hitsPerPage: limit, tags: 'story' },
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
      }),
    )
    .filter((i) => i.title);
}
