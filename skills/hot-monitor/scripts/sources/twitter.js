import { config } from '../config.js';
import { http, normalize } from './utils.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Twitter (X) 数据源，通过 twitterapi.io：https://twitterapi.io/
 * 端点：GET https://api.twitterapi.io/twitter/tweet/advanced_search
 * 认证：Header `X-API-Key: <key>`
 */
export async function searchTwitter(query, limit = 20) {
  const apiKey = config.sources.twitterApiKey;
  if (!apiKey) return [];

  const s = config.sources;
  const since = Math.floor(Date.now() / 1000) - Math.max(1, s.timeWindowHours) * 3600;

  try {
    const res = await http.get('https://api.twitterapi.io/twitter/tweet/advanced_search', {
      params: { query: `${query} since_time:${since}`, queryType: 'Top' },
      headers: { 'X-API-Key': apiKey },
    });

    const tweets = res.data?.tweets || [];

    return tweets
      .filter((t) => !(t.isReply || t.inReplyToId) && !t.retweeted_tweet)
      .slice(0, limit)
      .map((t) => {
        const username = t.author?.userName || '';
        const text = t.text || '';
        const likes = num(t.likeCount);
        const retweets = num(t.retweetCount);
        const views = num(t.viewCount);
        const followers = num(t.author?.followers);
        const verified = Boolean(t.author?.isBlueVerified);
        const replies = num(t.replyCount);
        const quotes = num(t.quoteCount);
        const authorName = t.author?.name || username;
        return normalize({
          title: text.slice(0, 120),
          url: t.url || (t.id ? `https://x.com/${username || 'i/web'}/status/${t.id}` : ''),
          snippet: text,
          source: 'Twitter',
          publishedAt: t.createdAt ? new Date(t.createdAt) : null,
          author: authorName,
          metrics: {
            likes,
            retweets,
            replyCount: replies,
            quoteCount: quotes,
            views,
            followers,
            verified,
            score: likes + retweets * 2 + Math.floor(views / 1000) + (verified ? s.twitterVerifiedBonus : 0),
          },
        });
      })
      .filter((i) => i.title && i.url);
  } catch (err) {
    console.warn('[twitter] 抓取失败:', err.message);
    return [];
  }
}
