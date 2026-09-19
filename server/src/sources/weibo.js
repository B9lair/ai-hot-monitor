import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { http, normalize, parseRelativeTime, parseChineseCount } from './utils.js';

/** 从微博卡片 .card-act 提取转发/评论/赞数量（失败返回 null） */
function extractWeiboMetrics($, el) {
  const reposts = parseChineseCount($(el).find('a[action-type="feed_list_forward"]').first().text());
  const comments = parseChineseCount($(el).find('a[action-type="feed_list_comment"]').first().text());
  const likes = parseChineseCount($(el).find('a[action-type="feed_list_like"] .woo-like-count').first().text());
  if (!reposts && !comments && !likes) return null;
  return { reposts, comments, likes };
}

/**
 * 微博关键词搜索（需 WEIBO_COOKIE）
 * 未配置 cookie 时返回空数组
 */
export async function searchWeibo(query, limit = 20) {
  const cookie = config.sources.weiboCookie;
  if (!cookie) return [];

  try {
    const res = await http.get('https://s.weibo.com/weibo', {
      params: { q: query },
      headers: {
        Referer: 'https://s.weibo.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Cookie: cookie,
      },
    });

    const $ = cheerio.load(res.data);
    const items = [];
    $('.card-wrap').each((_, el) => {
      const txt = $(el).find('.txt').first().text().trim();
      if (!txt) return;
      // 作者昵称：.info a.name（含 nick-name 属性）
      const nameA = $(el).find('.info a.name').first();
      const author = nameA.text().trim();
      // 微博正文详情链接：优先 weibo.com/{uid}/{mid}
      const fromA = $(el).find('.from a').first();
      const fromHref = fromA.attr('href') || '';
      const uidM = `${nameA.attr('href') || ''} ${fromHref}`.match(/weibo\.com\/(\d+)/);
      const uid = uidM ? uidM[1] : '';
      const mid = $(el).attr('mid') || '';
      let url = uid && mid ? `https://weibo.com/${uid}/${mid}` : fromHref;
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url) url = `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`;
      // 发布时间：.from 首个链接文本（如「09月16日 15:30」）
      const publishedAt = parseRelativeTime(fromA.text());
      // 互动指标：转发/评论/赞
      const metrics = extractWeiboMetrics($, el);
      items.push(
        normalize({
          title: txt.slice(0, 120),
          url,
          snippet: txt.slice(0, 200),
          source: '微博',
          publishedAt,
          author: author || '',
          ...(metrics ? { metrics } : {}),
        }),
      );
    });
    return items.slice(0, limit).filter((i) => i.title);
  } catch (err) {
    console.warn('[weibo:search] 抓取失败:', err.message);
    return [];
  }
}
