import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { http, normalize } from './utils.js';

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
      const from = $(el).find('.from a').first();
      const user = from.text().trim();
      const userHref = from.attr('href') || '';
      const mid = $(el).attr('mid') || '';
      let url = userHref.startsWith('//') ? 'https:' + userHref : userHref;
      if (mid && url.includes('/u/')) {
        // 尝试构造微博详情链接：weibo.com/{uid}/{mid}
        const m = url.match(/weibo\.com\/(\d+)/);
        if (m) url = `https://weibo.com/${m[1]}/${mid}`;
      }
      if (!url) url = `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`;
      if (txt) {
        items.push(
          normalize({
            title: txt.slice(0, 120),
            url,
            snippet: txt.slice(0, 200),
            source: '微博',
            publishedAt: null,
          }),
        );
      }
    });
    return items.slice(0, limit).filter((i) => i.title);
  } catch (err) {
    console.warn('[weibo:search] 抓取失败:', err.message);
    return [];
  }
}
