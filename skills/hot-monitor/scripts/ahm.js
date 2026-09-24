#!/usr/bin/env node
/**
 * AI Hot Monitor Skill CLI —— 自包含（无需后端 server）。
 * 核心链路：关键词 → 查询扩展 → 多源搜索 → 分层过滤 → AI 相关性+防伪 → 热点列表。
 */
import process from 'node:process';
import { config, hasAI } from './config.js';
import { searchAll } from './sources/index.js';
import { computeHotScore, normalizeUrl } from './sources/utils.js';
import { verifyKeywordHit, isRelevantHit, mentionsKeyword } from './ai.js';
import { expandQuery } from './expand.js';

const VERSION = '0.2.0';
const VERIFY_CONCURRENCY = 4;

const HELP = `AI Hot Monitor Skill CLI v${VERSION}（自包含，无需后端）

用法:
  node scripts/ahm.js search <关键词> [选项]

选项:
  --source Twitter,GitHub    限定数据源（逗号分隔，可用源见下）
  --limit N                  每源保留条数（默认取配置 perSourceLimit）
  --threshold 0.6            相关度阈值（0~1，默认取配置）
  --min-hot N                热度门槛（0~100，默认 0 = 关闭）
  --exclude-fake             只输出非假冒内容
  --no-expand                关闭查询扩展
  --config <file.json>       指定配置文件
  --pretty                   缩进美化 JSON 输出
  --help                     显示本帮助

可用数据源:
  Twitter / HackerNews / GitHub / B站 / 微博 / 知乎 / Bing / 百度 / 搜狗

示例:
  node scripts/ahm.js search "GPT-5"
  node scripts/ahm.js search "Claude Sonnet 4.6" --source GitHub,HackerNews --pretty
  node scripts/ahm.js search "@哔哩哔哩" --pretty

输出: JSON（{ keyword, total, results: [...] }），每条含 title/url/source/summary/
      relevance/hotScore/metrics/isFake/confidence/relevanceReason/author/publishedAt 等。
`;

const jstr = (v) => (process.argv.includes('--pretty') ? JSON.stringify(v, null, 2) : JSON.stringify(v));
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

/** 按给定上限并发执行，并保持结果顺序 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** AI 不可用时的降级结果：按关键词字面匹配 */
function fallbackResult(item, keyword, expansions) {
  const matched = mentionsKeyword(item, keyword, expansions);
  return {
    relevance: matched ? config.openrouter.relevanceThreshold : 0.2,
    keywordMentioned: matched,
    matchType: matched ? '直接相关' : '不相关',
    isFake: false,
    confidence: 0.5,
    summary: item.snippet || item.title,
    relevanceReason: matched ? 'AI 校验不可用，降级为关键词字面匹配（命中即视为相关）' : '',
    fakeReason: '',
  };
}

/** 数据源名称 → 内部 key 映射 */
const SOURCE_ALIAS = {
  twitter: 'twitter', Twitter: 'twitter',
  hackernews: 'hackernews', HackerNews: 'hackernews',
  github: 'github', GitHub: 'github',
  bilibili: 'bilibili', 'B站': 'bilibili',
  weibo: 'weibo', 微博: 'weibo',
  zhihu: 'zhihu', 知乎: 'zhihu',
  bing: 'bing', Bing: 'bing',
  baidu: 'baidu', 百度: 'baidu',
  sogou: 'sogou', 搜狗: 'sogou',
};

/** 限定数据源（覆盖 config.sources.enabled） */
function applySourceFilter(sourceArg) {
  const wanted = String(sourceArg).split(',').map((s) => s.trim()).filter(Boolean);
  const keys = wanted.map((w) => SOURCE_ALIAS[w]).filter(Boolean);
  if (!keys.length) return;
  const enabled = {};
  for (const k of Object.keys(config.sources.enabled)) enabled[k] = keys.includes(k);
  config.sources.enabled = enabled;
}

/** 主流程 */
async function search(keyword, opts = {}) {
  const threshold = Number(opts.threshold ?? config.openrouter.relevanceThreshold);
  const minHot = Number(opts['min-hot'] ?? 0);
  const keep = opts.limit ? Math.max(1, parseInt(opts.limit, 10)) : undefined;

  if (opts.source) applySourceFilter(opts.source);

  // 1. 查询扩展（可 --no-expand 关闭）
  const expansions = opts['no-expand'] ? [] : await expandQuery(keyword);

  // 2. 采集 + 第一/二层过滤
  const items = await searchAll(keyword, keep, expansions);

  // 3. 单次运行内 URL + normalizedUrl 去重
  const seenUrl = new Set();
  const seenNorm = new Set();
  const fresh = [];
  for (const it of items) {
    it.normalizedUrl = normalizeUrl(it.url);
    if (seenUrl.has(it.url) || seenNorm.has(it.normalizedUrl)) continue;
    seenUrl.add(it.url);
    seenNorm.add(it.normalizedUrl);
    fresh.push(it);
  }

  // 4. 廉价预过滤（账号查询跳过）
  const candidates =
    !keyword.startsWith('@') && config.openrouter.preFilterKeyword
      ? fresh.filter((i) => mentionsKeyword(i, keyword, expansions))
      : fresh;

  // 5. 受控并发 AI 校验（相关性 → 相关才真伪）
  const checked = await mapLimit(candidates, VERIFY_CONCURRENCY, async (item) => {
    try {
      if (hasAI()) {
        return { item, result: await verifyKeywordHit(keyword, item) };
      }
      return { item, result: fallbackResult(item, keyword, expansions) };
    } catch (err) {
      console.warn(`[ahm] AI 校验失败，降级为关键词匹配（${item.source}）: ${err.message}`);
      return { item, result: fallbackResult(item, keyword, expansions) };
    }
  });

  // 6. 组装输出
  const results = [];
  for (const row of checked) {
    if (!row) continue;
    const { item, result } = row;
    if (!isRelevantHit(result, threshold)) continue;
    if (opts['exclude-fake'] && result.isFake) continue;
    const hotScore = computeHotScore(item.source, item.metrics);
    if (minHot > 0 && hotScore != null && hotScore < minHot) continue;
    results.push({
      title: item.title,
      url: item.url,
      source: item.source,
      snippet: item.snippet || null,
      summary: result.summary || null,
      relevance: result.relevance ?? null,
      hotScore,
      metrics: item.metrics || null,
      isFake: result.isFake,
      confidence: result.confidence,
      relevanceReason: result.relevanceReason || null,
      fakeReason: result.fakeReason || null,
      author: item.author || null,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    });
  }

  // 7. 排序：热度优先，其次相关度
  results.sort(
    (a, b) => (b.hotScore ?? -1) - (a.hotScore ?? -1) || (b.relevance ?? -1) - (a.relevance ?? -1),
  );

  return { keyword, total: results.length, results };
}

/** 参数解析：位置参数 + --flag value / --flag=value / --flag */
function parseArgv(argv) {
  const args = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let val;
      if (key.includes('=')) {
        const idx = key.indexOf('=');
        val = key.slice(idx + 1);
        key = key.slice(0, idx);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        val = argv[++i];
      } else {
        val = true;
      }
      opts[key] = val;
    } else {
      args.push(a);
    }
  }
  return { args, opts };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  const { args, opts } = parseArgv(argv);
  const cmd = args[0];
  if (cmd !== 'search') {
    fail(`未知命令：${cmd}（用 --help 查看帮助）`);
  }
  const keyword = args[1];
  if (!keyword) fail('缺少关键词：search <关键词>');

  try {
    const result = await search(keyword, opts);
    console.log(jstr(result));
  } catch (e) {
    fail(e.message || String(e));
  }
}

main();
