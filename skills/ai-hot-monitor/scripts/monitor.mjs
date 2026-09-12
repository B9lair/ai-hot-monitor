#!/usr/bin/env node
/**
 * AI Hot Monitor - 关键词监控 CLI
 * 供其他 AI 或命令行调用，检查关键词的最新真实动态。
 */
import { parseArgs } from '../lib/cli.mjs';
import { searchAll } from '../../../server/src/sources/index.js';
import { verifyKeywordHit } from '../../../server/src/ai/openrouter.js';
import { hasAI } from '../../../server/src/config.js';

const args = parseArgs(process.argv.slice(2));

async function main() {
  const keyword = args.keyword || args.k;
  if (!keyword) {
    console.error('错误：缺少 --keyword 参数');
    process.exit(1);
  }
  const limit = parseInt(args.limit || args.l || '10', 10);

  const items = await searchAll(keyword, limit);
  const alerts = [];

  for (const item of items) {
    let result;
    if (hasAI()) {
      result = await verifyKeywordHit(keyword, item);
    } else {
      const matched = item.title.includes(keyword) || (item.snippet || '').includes(keyword);
      result = { isRelevant: matched, isFake: false, confidence: 0.6, summary: item.snippet || item.title };
    }

    if (!result.isRelevant) continue;
    if (result.isFake) continue; // 跳过假冒内容

    alerts.push({
      title: item.title,
      url: item.url,
      source: item.source,
      snippet: item.snippet,
      isFake: result.isFake,
      confidence: result.confidence,
      summary: result.summary,
    });
  }

  console.log(
    JSON.stringify(
      { keyword, scanned: items.length, verified: alerts.length, alerts },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('执行失败:', err.message);
  process.exit(1);
});
