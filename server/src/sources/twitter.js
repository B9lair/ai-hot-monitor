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
 *
 * 本适配器只做「采集 + 结构过滤」，不做质量过滤（分层原则）：
 * - 第一层：时间窗口以 `since_time` 下推（无发布时间的数据源只能本地过滤）
 * - 结构过滤：排除回复（isReply / inReplyToId）与转推（retweeted_tweet）
 * - 互动指标（likeCount / retweetCount / viewCount / author.followers / isBlueVerified）
 *   以 `metrics` 形式带出，由聚合层第二层统一过滤与排序
 */
export async function searchTwitter(query, limit = 20) {
  const apiKey = config.sources.twitterApiKey;
  if (!apiKey) return [];

  const s = config.sources;
  const since = Math.floor(Date.now() / 1000) - Math.max(1, s.timeWindowHours) * 3600;

  try {
    const res = await http.get('https://api.twitterapi.io/twitter/tweet/advanced_search', {
      // queryType=Top 取高热度推文；since_time 为第一层时间窗口下推
      params: { query: `${query} since_time:${since}`, queryType: 'Top' },
      headers: { 'X-API-Key': apiKey },
    });

    const tweets = res.data?.tweets || [];

    return tweets
      // 结构过滤：排除回复、转推
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
          // 第二层质量指标（聚合层使用，不入库）
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
