import * as cheerio from 'cheerio';
import { http, normalize, sleep } from './utils.js';

/**
 * 通用网页搜索结果抓取（无需 API key，注意控制频率）
 * 支持 Bing / DuckDuckGo / Google / 搜狗
 */

async function fetchBing(query, limit) {
  const res = await http.get('https://www.bing.com/search', {
    params: { q: query, count: limit },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('li.b_algo').each((_, el) => {
    const a = $(el).find('h2 a').first();
    const title = a.text().trim();
    const url = a.attr('href');
    const snippet = $(el).find('.b_caption p, .b_lineclamp2, p').first().text().trim();
    if (title && url) items.push({ title, url, snippet });
  });
  return items;
}

async function fetchDuckDuckGo(query, limit) {
  // 使用 DuckDuckGo 的 html 版，结构较稳定
  const res = await http.get('https://html.duckduckgo.com/html/', {
    params: { q: query },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('.result').each((_, el) => {
    const a = $(el).find('a.result__a').first();
    const title = a.text().trim();
    let url = a.attr('href') || '';
    const snippet = $(el).find('.result__snippet').text().trim();
    if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
      try {
        url = decodeURIComponent(new URL('https:' + url).searchParams.get('uddg') || url);
      } catch {
        /* ignore */
      }
    }
    if (title && url) items.push({ title, url, snippet });
  });
  return items;
}

async function fetchGoogle(query, limit) {
  // Google 结果页经常有反爬，尝试抓取，失败则返回空
  const res = await http.get('https://www.google.com/search', {
    params: { q: query, num: limit, hl: 'zh-CN' },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('div.g, div[data-hveid]').each((_, el) => {
    const a = $(el).find('a').filter((__, e) => $(e).find('h3').length > 0).first();
    const title = $(el).find('h3').first().text().trim();
    const url = a.attr('href') || '';
    const snippet = $(el).find('div[data-sncf], span.aCOpRe').first().text().trim();
    if (title && url) items.push({ title, url, snippet });
  });
  return items;
}

async function fetchSogou(query, limit) {
  const res = await http.get('https://www.sogou.com/web', {
    params: { query },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('.vrwrap, .rb').each((_, el) => {
    const a = $(el).find('h3 a').first();
    const title = a.text().trim();
    const url = a.attr('href') || '';
    const snippet = $(el).find('.str_info, .text-layout, .fz-mid').first().text().trim();
    if (title && url) items.push({ title, url, snippet });
  });
  return items;
}

/**
 * 搜索指定引擎
 * @param {string} engine bing | duckduckgo | google | sogou
 */
export async function searchWeb(engine, query, limit = 15) {
  const fns = {
    bing: fetchBing,
    duckduckgo: fetchDuckDuckGo,
    google: fetchGoogle,
    sogou: fetchSogou,
  };
  const fn = fns[engine];
  if (!fn) return [];

  try {
    const items = await fn(query, limit);
    return items.slice(0, limit).map((i) => normalize({ ...i, source: engineName(engine) }));
  } catch (err) {
    console.warn(`[websearch:${engine}] 抓取失败:`, err.message);
    return [];
  }
}

function engineName(engine) {
  return { bing: 'Bing', duckduckgo: 'DuckDuckGo', google: 'Google', sogou: '搜狗' }[engine] || engine;
}

/**
 * 依次搜索多个引擎（带延时避免被封）
 */
export async function searchMultiEngines(query, engines = ['bing', 'duckduckgo', 'sogou'], limit = 10) {
  const results = [];
  for (const engine of engines) {
    const items = await searchWeb(engine, query, limit);
    results.push(...items);
    await sleep(600);
  }
  return results;
}
