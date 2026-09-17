import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { http, normalize } from './utils.js';

const BILI_HEADERS = {
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Cookie: 'buvid3=infoc; buvid4=infoc',
};

/** 解析 B站中文缩写计数（如 "1.2万" → 12000、"3.4亿" → 3.4e8） */
function parseCount(text) {
  if (!text) return 0;
  const m = String(text).trim().replace(/,/g, '').match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return 0;
  if (m[2] === '万') n *= 10000;
  else if (m[2] === '亿') n *= 100000000;
  return n;
}

/**
 * 从 B站综合搜索页（search.bilibili.com/all）解析视频卡片。
 * 说明：B站搜索 API（search/type）需 wbi 签名、返回 412，故改用网页版综合搜索页爬虫。
 */
async function fetchBiliAll(query, limit = 20) {
  const res = await http.get('https://search.bilibili.com/all', {
    params: { keyword: query },
    headers: { ...BILI_HEADERS, Referer: 'https://search.bilibili.com' },
  });
  const $ = cheerio.load(res.data);
  const videos = [];
  $('.bili-video-card').each((_, el) => {
    const h3 = $(el).find('h3').first();
    const title = (h3.attr('title') || h3.text() || '').trim();
    const linkA = $(el).find('a[href*="/video/"]').first();
    let href = (linkA.attr('href') || '').trim();
    if (href.startsWith('//')) href = 'https:' + href;
    const upA = $(el).find('a[href*="space.bilibili.com"]').first();
    const upText = (upA.text() || '').trim();
    const upName = upText.split('·')[0].trim();
    // 播放量：取统计区第一个 item（尽力解析，可能为空/不稳定）
    const statsItems = $(el).find('.bili-video-card__stats--item');
    const views = statsItems.length ? parseCount($(statsItems[0]).text()) : 0;
    videos.push({ title, url: href, upName, views });
  });
  return videos.slice(0, limit).filter((v) => v.title && v.url);
}

/**
 * B站视频搜索（网页爬虫）
 */
export async function searchBilibili(query, limit = 20) {
  try {
    const vids = await fetchBiliAll(query, limit);
    return vids.map((v) =>
      normalize({
        title: v.title,
        url: v.url,
        snippet: '',
        source: 'B站',
        publishedAt: null,
        author: v.upName || '',
        // 热度指标：播放量（尽力解析，可能为 0）
        ...(v.views ? { metrics: { views: v.views } } : {}),
      }),
    );
  } catch (err) {
    console.warn('[bilibili] 抓取失败:', err.message);
    return [];
  }
}

/** 递归收集含 uname + mid 的对象 */
function collectUsers(obj, out = [], depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectUsers(item, out, depth + 1);
    return;
  }
  if (typeof obj.uname === 'string' && typeof obj.mid === 'number') {
    out.push(obj);
  }
  for (const k of Object.keys(obj)) collectUsers(obj[k], out, depth + 1);
}

/**
 * 从 B站 UP 主搜索页（search.bilibili.com/upuser）精确提取账号结果。
 * 页面数据在 window.__pinia 中（混淆压缩），用 vm 反序列化后遍历提取。
 */
async function fetchBiliUsers(query) {
  const res = await http.get('https://search.bilibili.com/upuser', {
    params: { keyword: query },
    headers: { ...BILI_HEADERS, Referer: 'https://search.bilibili.com' },
  });
  const $ = cheerio.load(res.data);
  let piniaCode = '';
  $('script').each((_, el) => {
    const t = $(el).text() || '';
    if (t.includes('window.__pinia')) piniaCode = t;
  });
  if (!piniaCode) return [];

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(piniaCode, sandbox, { timeout: 3000 });
  const pinia = sandbox.window.__pinia;

  const all = [];
  collectUsers(pinia, all);
  // 仅保留真实账号结果（uname 非空且 fans 为数字）
  return all.filter((u) => u.uname && typeof u.fans === 'number');
}

/**
 * B站 UP 主账号搜索（用于账号检测），返回账号信息 + 其最新视频
 */
export async function searchBilibiliUser(query, limit = 5) {
  try {
    const users = await fetchBiliUsers(query);
    return users.slice(0, limit).map((u) => ({
      mid: String(u.mid),
      uname: u.uname,
      fans: u.fans ?? 0,
      signature: u.usign || '',
      videos: u.videos ?? 0,
      url: `https://space.bilibili.com/${u.mid}`,
      res: Array.isArray(u.res) ? u.res : [],
    }));
  } catch (err) {
    console.warn('[bilibili:user] 抓取失败:', err.message);
    return [];
  }
}

/**
 * 从账号搜索结果中提取该 UP 主的最新视频（upuser 页已内嵌 res 列表）
 */
export async function getBilibiliUserVideos(user, limit = 10) {
  try {
    return (user.res || [])
      .slice(0, limit)
      .map((v) =>
        normalize({
          title: v.title || '',
          url: v.arcurl || (v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : ''),
          snippet: '',
          source: 'B站',
          publishedAt: v.pubdate ? new Date(v.pubdate * 1000) : null,
        }),
      )
      .filter((i) => i.title && i.url);
  } catch (err) {
    console.warn('[bilibili:user-videos] 抓取失败:', err.message);
    return [];
  }
}
