import { config } from '../config.js';
import { http, normalize } from './utils.js';

/**
 * Twitter (X) 数据源，通过 Sorsa API：https://sorsa.io/
 * 端点：POST https://api.sorsa.io/v3/search-tweets
 * 认证：Header `ApiKey: <key>`
 */
export async function searchTwitter(query, limit = 20) {
  const apiKey = config.sources.twitterApiKey;
  if (!apiKey) return [];

  try {
    const res = await http.post(
      'https://api.sorsa.io/v3/search-tweets',
      { query, order: 'latest' },
      { headers: { ApiKey: apiKey } },
    );

    const tweets = res.data?.tweets || [];
    return tweets
      .slice(0, limit)
      .map((t) => {
        const username = t.user?.username || '';
        return normalize({
          title: (t.full_text || '').slice(0, 120),
          url: t.id ? `https://x.com/${username || 'i/web'}/status/${t.id}` : '',
          snippet: t.full_text || '',
          source: 'Twitter',
          publishedAt: t.created_at ? new Date(t.created_at) : null,
        });
      })
      .filter((i) => i.title && i.url);
  } catch (err) {
    console.warn('[twitter] 抓取失败:', err.message);
    return [];
  }
}
