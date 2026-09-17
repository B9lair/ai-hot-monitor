import { config } from '../config.js';
import { searchHackerNews } from './hackernews.js';
import { searchMultiEngines } from './websearch.js';
import { searchTwitter } from './twitter.js';
import { searchBilibili } from './bilibili.js';
import { searchWeibo } from './weibo.js';
import { searchGithub } from './github.js';
import { searchZhihu } from './zhihu.js';
import { searchReddit } from './reddit.js';
import { searchV2ex } from './v2ex.js';
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
 *   采集（各源并行、放宽条数）
 *   → 第一层 基础过滤（格式校验 / URL 去重 / 时间窗口）
 *   → 第二层 质量过滤（社交指标 + 作者信誉 + 每源保留上限）
 *   第三层 AI 深度分析由 services/monitor.js 完成。
 * 支持 @ 前缀账号检测：@xxx 直接获取账号信息与其最新动态。
 * @param {string} keyword
 * @param {number} [keep] 每源保留条数（默认取 config.sources.perSourceLimit）
 */
export async function searchAll(keyword, keep) {
  if (isAccountQuery(keyword)) {
    return dedupe(await searchAccount(keyword, keep || config.sources.perSourceLimit));
  }

  const s = config.sources;
  // 采集阶段放宽（默认 20 条/源），保留条数交给质量层控制，避免"先截断后过滤"
  const collect = Math.max(s.collectLimit, s.perSourceLimit);
  const perSourceKeep = keep || s.perSourceLimit;

  const tasks = [
    { key: 'twitter', run: () => searchTwitter(keyword, collect) },
    { key: 'hackernews', run: () => searchHackerNews(keyword, collect) },
    { key: 'bilibili', run: () => searchBilibili(keyword, collect) },
    { key: 'weibo', run: () => searchWeibo(keyword, collect) },
    { key: 'github', run: () => searchGithub(keyword, collect) },
    { key: 'zhihu', run: () => searchZhihu(keyword, collect) },
    // 境外源：默认关闭，挂代理/换网络后可经 .env 开启
    { key: 'reddit', run: () => searchReddit(keyword, collect) },
    { key: 'v2ex', run: () => searchV2ex(keyword, collect) },
    { key: null, run: () => searchMultiEngines(keyword, undefined, collect) },
  ];

  const raw = await runAll(tasks);
  const basic = applyBasicFilter(raw, s); // 第一层
  return applyQualityFilter(basic, { ...s, perSourceLimit: perSourceKeep }); // 第二层
}
