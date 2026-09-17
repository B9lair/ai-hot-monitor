import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { http, normalize, sleep } from './utils.js';

/**
 * 通用网页搜索结果抓取（无需 API key，注意控制频率）
 * 支持 Bing / DuckDuckGo / Google / 搜狗 / 百度
 *
 * 反爬对策：
 * 1. 会话预热：先访问首页收取 Set-Cookie，搜索时带上 Cookie + Referer + Accept-Language
 * 2. 验证页检测：识别「安全验证」等挑战页并明确告警（不再静默返回空数组）
 * 3. 熔断：同一引擎连续失败达阈值后冷却，避免每轮撞风控、白等超时
 */

const ZH_HEADERS = { 'Accept-Language': 'zh-CN,zh;q=0.9' };

/** 首页 Cookie 缓存：host -> { cookie, ts } */
const cookieJar = new Map();
const COOKIE_TTL_MS = 30 * 60 * 1000;

async function warmupCookies(homeUrl, host) {
  const cached = cookieJar.get(host);
  if (cached && Date.now() - cached.ts < COOKIE_TTL_MS) return cached.cookie;

  try {
    const res = await http.get(homeUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      validateStatus: () => true,
    });
    const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    if (cookie) cookieJar.set(host, { cookie, ts: Date.now() });
    return cookie;
  } catch (err) {
    console.warn(`[websearch:${host}] 会话预热失败:`, err.message);
    return '';
  }
}

/** 熔断状态：engine -> { failCount, cooldownUntil, lastReason } */
const breaker = new Map();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

export function isCoolingDown(engine) {
  const st = breaker.get(engine);
  return Boolean(st && st.cooldownUntil > Date.now());
}

function markFail(engine, reason) {
  const st = breaker.get(engine) || { failCount: 0, cooldownUntil: 0, lastReason: '' };
  st.failCount += 1;
  st.lastReason = reason;
  if (st.failCount >= BREAKER_THRESHOLD) {
    st.cooldownUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.warn(
      `[websearch:${engine}] 连续失败 ${st.failCount} 次，熔断 ${BREAKER_COOLDOWN_MS / 60000} 分钟：${reason}`,
    );
  } else {
    console.warn(`[websearch:${engine}] 抓取异常（${st.failCount}/${BREAKER_THRESHOLD}）：${reason}`);
  }
  breaker.set(engine, st);
}

function markOk(engine) {
  breaker.delete(engine);
}

/** 识别反爬验证页 / 空结构；命中则记一次失败并返回 true */
function detectChallenge(engine, $, html, nodeCount) {
  const title = $('title').text().trim();
  if (/安全验证|验证码|人机|robot|verify/i.test(title) || html.includes('百度安全验证')) {
    markFail(engine, `触发反爬验证页（title="${title}"）`);
    return true;
  }
  if (nodeCount === 0 && html.length < 20000) {
    markFail(engine, `未解析到结果节点（页面 ${html.length} 字节，title="${title}"）`);
    return true;
  }
  return false;
}

async function fetchBing(engine, query, limit) {
  const res = await http.get('https://www.bing.com/search', {
    params: { q: query, count: limit },
    headers: { ...ZH_HEADERS },
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
  if (detectChallenge(engine, $, res.data, items.length)) return [];
  return items;
}

async function fetchDuckDuckGo(engine, query, limit) {
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
  if (detectChallenge(engine, $, res.data, items.length)) return [];
  return items;
}

async function fetchGoogle(engine, query, limit) {
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
  if (detectChallenge(engine, $, res.data, items.length)) return [];
  return items;
}

async function fetchSogou(engine, query, limit) {
  // 搜狗：先预热首页取 Cookie，再带 Cookie + Referer 请求搜索页
  const cookie = await warmupCookies('https://www.sogou.com/', 'sogou');
  const res = await http.get('https://www.sogou.com/web', {
    params: { query },
    headers: {
      ...ZH_HEADERS,
      Referer: 'https://www.sogou.com/',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('.vrwrap, .rb').each((_, el) => {
    const a = $(el).find('h3 a').first();
    const title = a.text().trim();
    let url = a.attr('href') || '';
    // 搜狗结果是 /link?url=xxx 跳转链接，拼接域名使其可点击
    if (url.startsWith('/')) url = 'https://www.sogou.com' + url;
    const snippet = $(el).find('.str_info, .text-layout, .fz-mid').first().text().trim();
    if (title && url) items.push({ title, url, snippet });
  });
  if (detectChallenge(engine, $, res.data, items.length)) return [];
  return items;
}

async function fetchBaidu(engine, query, limit) {
  // 移动版百度，反爬较 PC 版弱（PC 版易触发安全验证）
  const cookie = await warmupCookies('https://m.baidu.com/', 'baidu');
  const res = await http.get('https://m.baidu.com/s', {
    params: { word: query },
    headers: {
      ...ZH_HEADERS,
      Referer: 'https://m.baidu.com/',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $('.result, .c-result').each((_, el) => {
    const title =
      $(el).find('h3').first().text().trim() ||
      $(el).find('.c-title').first().text().trim() ||
      $(el).find('a').first().text().trim();
    // 真实链接优先取 data-log 的 mu 字段，兜底取 a.href
    let url = '';
    const dataLog = $(el).attr('data-log') || '';
    const mm = dataLog.match(/mu(?:&quot;|")\s*:\s*(?:&quot;|")([^"&]+)/);
    if (mm) url = mm[1].replace(/\\u002F/g, '/').replace(/\\u003D/g, '=');
    if (!url) {
      const a = $(el).find('a').first();
      url = a.attr('href') || '';
      if (url.startsWith('/')) url = 'https://m.baidu.com' + url;
    }
    const snippet = $(el).find('.c-abstract, .c-line-clamp2, .result-abstract').first().text().trim();
    // 过滤相关搜索推荐（/s?word= 开头）
    if (title && url && !url.includes('/s?word=')) items.push({ title, url, snippet });
  });
  if (detectChallenge(engine, $, res.data, items.length)) return [];
  return items;
}

/**
 * 搜索指定引擎
 * @param {string} engine bing | duckduckgo | google | sogou | baidu
 */
export async function searchWeb(engine, query, limit = 15) {
  const fns = {
    bing: fetchBing,
    duckduckgo: fetchDuckDuckGo,
    google: fetchGoogle,
    sogou: fetchSogou,
    baidu: fetchBaidu,
  };
  const fn = fns[engine];
  if (!fn) return [];

  if (isCoolingDown(engine)) {
    console.warn(`[websearch:${engine}] 处于熔断冷却期，跳过`);
    return [];
  }

  try {
    const items = await fn(engine, query, limit);
    if (items.length > 0) markOk(engine);
    return items.slice(0, limit).map((i) => normalize({ ...i, source: engineName(engine) }));
  } catch (err) {
    markFail(engine, err.message);
    return [];
  }
}

function engineName(engine) {
  return { bing: 'Bing', duckduckgo: 'DuckDuckGo', google: 'Google', sogou: '搜狗', baidu: '百度' }[engine] || engine;
}

/**
 * 返回当前启用（配置开启）的搜索引擎列表
 */
export function enabledEngines() {
  const map = {
    bing: config.sources.enabled.bing,
    duckduckgo: config.sources.enabled.duckduckgo,
    google: config.sources.enabled.google,
    sogou: config.sources.enabled.sogou,
    baidu: config.sources.enabled.baidu,
  };
  return Object.keys(map).filter((k) => map[k]);
}

/**
 * 依次搜索多个引擎（带延时避免被封）；处于熔断期的引擎直接跳过
 */
export async function searchMultiEngines(query, engines, limit = 10) {
  const list = engines || enabledEngines();
  const results = [];
  for (const engine of list) {
    if (isCoolingDown(engine)) {
      console.warn(`[websearch:${engine}] 熔断中，跳过本轮`);
      continue;
    }
    const items = await searchWeb(engine, query, limit);
    results.push(...items);
    await sleep(600);
  }
  return results;
}
