import { normalize } from './utils.js';
import { searchBilibiliUser, getBilibiliUserVideos } from './bilibili.js';
import { searchWeibo } from './weibo.js';
import { searchTwitter } from './twitter.js';

/** 账号检测：当关键词以 @ 开头时，视为账号查询 */

export function isAccountQuery(keyword) {
  return typeof keyword === 'string' && keyword.trim().startsWith('@');
}

export function accountName(keyword) {
  return keyword.trim().replace(/^@/, '').trim();
}

/**
 * 账号信息获取：B站 UP 主（核心）/ 微博账号 / Twitter 账号
 * @param {string} keyword 形如 @OpenAI
 * @param {number} limit
 */
export async function searchAccount(keyword, limit = 10) {
  const name = accountName(keyword);
  const items = [];

  try {
    const users = await searchBilibiliUser(name, 3);
    for (const u of users) {
      items.push(
        normalize({
          title: `${u.uname} · B站 UP 主`,
          url: u.url,
          snippet: [`${u.fans} 粉丝`, u.signature].filter(Boolean).join(' | '),
          source: 'B站账号',
          publishedAt: null,
        }),
      );
      const videos = await getBilibiliUserVideos(u, limit);
      for (const v of videos) {
        items.push({ ...v, source: 'B站' });
      }
    }
  } catch (err) {
    console.warn('[account:bilibili] 失败:', err.message);
  }

  try {
    const weibos = await searchWeibo(name, 5);
    for (const w of weibos) items.push({ ...w, source: '微博' });
  } catch (err) {
    console.warn('[account:weibo] 失败:', err.message);
  }

  try {
    const tweets = await searchTwitter(name, limit);
    for (const t of tweets) items.push({ ...t, source: 'Twitter' });
  } catch (err) {
    console.warn('[account:twitter] 失败:', err.message);
  }

  return items;
}
