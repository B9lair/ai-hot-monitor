import { config } from '../config.js';
import { searchHackerNews } from './hackernews.js';
import { searchMultiEngines } from './websearch.js';
import { searchTwitter } from './twitter.js';
import { searchBilibili } from './bilibili.js';
import { searchWeibo } from './weibo.js';
import { searchGithub } from './github.js';
import { searchZhihu } from './zhihu.js';
import { isAccountQuery, searchAccount } from './account.js';
import { applyBasicFilter, applyQualityFilter } from './filter.js';

/** 按 URL 去重 */
function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}

/** 并行执行已启用源的任务，单个源失败不影响整体 */
async function runAll(tasks) {
  const enabled = config.sources.enabled;
  const active = tasks.filter((t) => (t.key ? enabled[t.key] : true));

  const results = await Promise.allSettled(active.map((t) => t.run()));
  const items = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      items.push(...r.value);
    }
  });
  return items;
}

/**
 * 关键词搜索（分层进行）：
 *   采集 → 第一层 基础过滤 → 第二层 质量过滤
 *   第三层 AI 深度分析由 ahm.js 主流程完成。
 * 支持 @ 前缀账号检测。
 */
export async function searchAll(keyword, keep, extraQueries = []) {
  if (isAccountQuery(keyword)) {
    return dedupe(await searchAccount(keyword, keep || config.sources.perSourceLimit));
  }

  const s = config.sources;
  const collect = Math.max(s.collectLimit, s.perSourceLimit);
  const perSourceKeep = keep || s.perSourceLimit;
  const collectExtra = Math.max(1, Math.floor(collect / 2));

  const queries = [
    { q: keyword, collect, includeEngines: true },
    ...extraQueries
      .filter((q) => q && q !== keyword)
      .map((q) => ({ q, collect: collectExtra, includeEngines: false })),
  ];

  const buildTasks = (q, c, includeEngines) => [
    { key: 'twitter', run: () => searchTwitter(q, c) },
    { key: 'hackernews', run: () => searchHackerNews(q, c) },
    { key: 'bilibili', run: () => searchBilibili(q, c) },
    { key: 'weibo', run: () => searchWeibo(q, c) },
    { key: 'github', run: () => searchGithub(q, c) },
    { key: 'zhihu', run: () => searchZhihu(q, c) },
    // 搜索引擎本身具备语义召回、反爬风险高，仅主词搜索一次
    ...(includeEngines ? [{ key: null, run: () => searchMultiEngines(q, undefined, c) }] : []),
  ];

  const raw = [];
  // 按查询词串行（各查询词内部多源并行），避免多查询词同时打搜索引擎触发风控
  for (const { q, collect: c, includeEngines } of queries) {
    const items = await runAll(buildTasks(q, c, includeEngines));
    raw.push(...items);
  }

  const basic = applyBasicFilter(raw, s); // 第一层
  return applyQualityFilter(basic, { ...s, perSourceLimit: perSourceKeep }); // 第二层
}
