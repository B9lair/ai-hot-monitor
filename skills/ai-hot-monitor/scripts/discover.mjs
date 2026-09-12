#!/usr/bin/env node
/**
 * AI Hot Monitor - 热点发现 CLI
 * 供其他 AI 或命令行调用，发现指定领域的热点。
 */
import { parseArgs } from '../lib/cli.mjs';
import { discoverAll } from '../../../server/src/sources/index.js';
import { aggregateHotspots } from '../../../server/src/ai/openrouter.js';
import { hasAI } from '../../../server/src/config.js';

const args = parseArgs(process.argv.slice(2));

async function main() {
  const topic = args.topic || args.t;
  if (!topic) {
    console.error('错误：缺少 --topic 参数');
    process.exit(1);
  }
  const limit = parseInt(args.limit || args.l || '10', 10);

  const items = await discoverAll(topic, limit);

  let hotspots = [];
  if (hasAI() && items.length > 0) {
    hotspots = await aggregateHotspots(topic, items);
  } else {
    hotspots = items.slice(0, 10).map((it) => ({
      title: it.title,
      summary: it.snippet || '',
      category: '未分类',
      hotness: 50,
      url: it.url,
      source: it.source,
    }));
  }

  console.log(
    JSON.stringify({ topic, scanned: items.length, hotspots }, null, 2),
  );
}

main().catch((err) => {
  console.error('执行失败:', err.message);
  process.exit(1);
});
