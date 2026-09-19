import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { http, normalize, parseChineseCount } from './utils.js';

const BILI_HEADERS = {
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Cookie: 'buvid3=infoc; buvid4=infoc',
};

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
    // 提取 bvid（如 /video/BV1xx411c7mD）
    const bvidM = href.match(/\/video\/(BV[0-9A-Za-z]+)/);
    const bvid = bvidM ? bvidM[1] : '';
    // 播放量：取统计区第一个 item（尽力解析，可能为空/不稳定）
    const statsItems = $(el).find('.bili-video-card__stats--item');
    const views = statsItems.length ? parseChineseCount($(statsItems[0]).text()) : 0;
    videos.push({ title, url: href, bvid, upName, views });
  });
  return videos.slice(0, limit).filter((v) => v.title && v.url);
}

/** 调用 B站公开详情接口（无需 wbi 签名）获取完整互动数据与简介/发布时间 */
async function fetchBiliDetail(bvid) {
  const headers = {
    ...BILI_HEADERS,
    Referer: `https://www.bilibili.com/video/${bvid}`,
  };
  if (config.sources.biliSessdata) {
    headers.Cookie = `${BILI_HEADERS.Cookie}; SESSDATA=${config.sources.biliSessdata}`;
  }
  const res = await http.get('https://api.bilibili.com/x/web-interface/view', {
    params: { bvid },
    headers,
  });
  const d = res.data?.data;
  if (!d) return null;
  const stat = d.stat || {};
  return {
    desc: d.desc || '',
    pubdate: d.pubdate ? new Date(d.pubdate * 1000) : null,
    owner: d.owner?.name || '',
    views: stat.view || 0,
    danmaku: stat.danmaku || 0,
    comments: stat.reply || 0,
    favorites: stat.favorite || 0,
    coins: stat.coin || 0,
    shares: stat.share || 0,
    likes: stat.like || 0,
  };
}

/**
 * B站视频搜索（网页爬虫）+ 详情富化（补充播放/赞/投币/收藏/弹幕/评论/分享与发布时间）
 */
export async function searchBilibili(query, limit = 20) {
  try {
    const vids = await fetchBiliAll(query, limit);
    const s = config.sources;
    const enrich = s.enrichBilibili !== false;
    const enrichLimit = Math.max(1, Number(s.enrichLimit) || 5);
    const targets = enrich ? vids.slice(0, enrichLimit).filter((v) => v.bvid) : [];

    // top-K 并行富化，单条失败不影响整体
    const enriched = new Map();
    if (targets.length) {
      await Promise.all(
        targets.map(async (v) => {
          try {
            const d = await fetchBiliDetail(v.bvid);
            if (d) enriched.set(v.bvid, d);
          } catch (err) {
            console.warn(`[bilibili:enrich] ${v.bvid} 富化失败:`, err.message);
          }
        }),
      );
    }

    return vids.map((v) => {
      const d = enriched.get(v.bvid);
      const metrics = d
        ? {
            views: d.views,
            likes: d.likes,
            coins: d.coins,
            favorites: d.favorites,
            danmaku: d.danmaku,
            comments: d.comments,
            shares: d.shares,
          }
        : v.views
          ? { views: v.views }
          : null;
      return normalize({
        title: v.title,
        url: v.url,
        snippet: d ? d.desc.slice(0, 200) : '',
        source: 'B站',
        publishedAt: d ? d.pubdate : null,
        author: (d?.owner || v.upName) || '',
        ...(metrics ? { metrics } : {}),
      });
    });
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
