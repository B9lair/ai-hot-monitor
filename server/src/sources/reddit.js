import { http, normalize, UA } from './utils.js';

/**
 * Reddit 关键词搜索（公开 JSON 接口，无需 key）
 * 说明：Reddit 为境外站点，国内网络不可直连，默认关闭（SOURCE_REDDIT=false），
 *      挂代理/换网络后可经 .env 手动开启。
 */
export async function searchReddit(query, limit = 20) {
  try {
    const res = await http.get('https://www.reddit.com/search.json', {
      params: { q: query, limit, sort: 'new' },
      headers: { 'User-Agent': UA },
    });
    const children = res.data?.data?.children || [];
    return children
      .map((c) => {
        const d = c?.data || {};
        return normalize({
          title: d.title || '',
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || '',
          snippet: String(d.selftext || '').slice(0, 200),
          source: 'Reddit',
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
        });
      })
      .slice(0, limit)
      .filter((i) => i.title && i.url);
  } catch (err) {
    console.warn('[reddit:search] 抓取失败:', err.message);
    return [];
  }
}
