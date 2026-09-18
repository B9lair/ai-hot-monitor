#!/usr/bin/env node
/**
 * AI 相关性判定离线评估脚本
 *
 * 用法（在 server 目录下执行）：
 *   node scripts/eval-ai.mjs                      # 全量跑金标准数据集
 *   node scripts/eval-ai.mjs --threshold 0.7      # 指定相关性阈值
 *   node scripts/eval-ai.mjs --judge              # 额外用 AI 法官对摘要/理由质量打分
 *   node scripts/eval-ai.mjs --filter keyword=GPT-5
 *   node scripts/eval-ai.mjs --limit 5
 *   node scripts/eval-ai.mjs --seed               # 从历史 Alert 导出正样本（人工补负样本后合并）
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyKeywordHit, isRelevantHit, judgeQuality } from '../src/ai/openrouter.js';
import { config, hasAI } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.resolve(__dirname, '../src/ai/eval/cases.json');

function parseArgs(argv) {
  const a = {
    threshold: config.openrouter.relevanceThreshold,
    judge: false,
    seed: false,
    filter: '',
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--threshold') a.threshold = Number(argv[++i]);
    else if (x === '--judge') a.judge = true;
    else if (x === '--seed') a.seed = true;
    else if (x === '--filter') a.filter = argv[++i];
    else if (x === '--limit') a.limit = Number(argv[++i]);
  }
  return a;
}

function selectCases(raw, args) {
  let list = raw.cases || [];
  if (args.filter) {
    const idx = args.filter.indexOf('=');
    if (idx > 0) {
      const k = args.filter.slice(0, idx);
      const v = args.filter.slice(idx + 1);
      list = list.filter((c) => String(c[k]) === v);
    }
  }
  if (args.limit > 0) list = list.slice(0, args.limit);
  return list;
}

function computeMetrics(rows) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of rows) {
    const exp = Boolean(r.c.expectRelevant);
    const pred = r.predicted;
    if (exp && pred) tp++;
    else if (exp && !pred) fn++;
    else if (!exp && pred) fp++;
    else tn++;
  }
  const total = rows.length;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { total, tp, fp, fn, tn, accuracy, precision, recall, f1 };
}

function computeFakeMetrics(rows) {
  const subset = rows.filter((r) => typeof r.c.expectFake === 'boolean');
  if (subset.length === 0) return null;
  let correct = 0;
  for (const r of subset) {
    if (Boolean(r.r.isFake) === Boolean(r.c.expectFake)) correct++;
  }
  return { total: subset.length, correct, accuracy: correct / subset.length };
}

async function run(args) {
  const raw = JSON.parse(await readFile(CASES_PATH, 'utf8'));
  const cases = selectCases(raw, args);
  if (cases.length === 0) {
    console.log('没有匹配的用例。');
    return;
  }
  if (!hasAI()) {
    console.error('未配置 OPENROUTER_API_KEY，无法运行评估。请在 server/.env 填写。');
    process.exit(1);
  }

  console.log('\n=== AI 相关性判定评估 ===');
  console.log(
    `模型：${config.openrouter.model}  阈值：${args.threshold}  用例数：${cases.length}` +
      (args.judge ? `  法官模型：${config.openrouter.judgeModel || config.openrouter.model}` : ''),
  );
  console.log('');

  const rows = [];
  for (const c of cases) {
    const item = { title: c.title, snippet: c.snippet, source: c.source };
    const r = await verifyKeywordHit(c.keyword, item);
    const predicted = isRelevantHit(r, args.threshold);
    let judge = null;
    if (args.judge) judge = await judgeQuality(c.keyword, item, r);
    rows.push({ c, r, predicted, judge });

    const mark = predicted === Boolean(c.expectRelevant) ? '✓' : '✗';
    console.log(`[${mark}] ${c.id}  「${c.keyword}」`);
    console.log(`      标题: ${c.title}`);
    console.log(
      `      相关度 ${r.relevance.toFixed(2)} → 判定 ${predicted ? '相关' : '不相关'}（期望 ${c.expectRelevant ? '相关' : '不相关'}）`,
    );
    if (typeof c.expectFake === 'boolean') {
      console.log(`      真伪 ${r.isFake ? '疑似假冒' : '真实'}（期望 ${c.expectFake ? '疑似假冒' : '真实'}）`);
    }
    if (judge) {
      console.log(`      法官: 摘要 ${judge.summaryScore}/5 · 理由 ${judge.reasonScore}/5 — ${judge.comment}`);
    }
    console.log(`      摘要: ${r.summary}`);
    console.log(`      理由: ${r.relevanceReason}`);
    console.log('');
  }

  const m = computeMetrics(rows);
  const f = computeFakeMetrics(rows);
  console.log('=== 相关判定汇总 ===');
  console.log(`样本 ${m.total} · 正确 ${m.tp + m.tn} · 错误 ${m.fp + m.fn}`);
  console.log(`准确率 Accuracy   ${(m.accuracy * 100).toFixed(1)}%`);
  console.log(`精确率 Precision  ${(m.precision * 100).toFixed(1)}%`);
  console.log(`召回率 Recall     ${(m.recall * 100).toFixed(1)}%`);
  console.log(`F1               ${m.f1.toFixed(3)}`);
  if (f) {
    console.log(`\n=== 真伪判定 ===\n准确率 ${(f.accuracy * 100).toFixed(1)}% (${f.correct}/${f.total})`);
  }
  if (args.judge) {
    const sj = rows.filter((r) => r.judge);
    const avgS = sj.reduce((s, r) => s + r.judge.summaryScore, 0) / sj.length;
    const avgR = sj.reduce((s, r) => s + r.judge.reasonScore, 0) / sj.length;
    console.log(`\n=== AI 法官打分 ===\n摘要平均 ${avgS.toFixed(2)}/5 · 理由平均 ${avgR.toFixed(2)}/5`);
  }

  const wrong = rows.filter((r) => r.predicted !== Boolean(r.c.expectRelevant));
  if (wrong.length) {
    console.log('\n=== 判错用例 ===');
    for (const r of wrong) {
      console.log(`- ${r.c.id}（期望 ${r.c.expectRelevant ? '相关' : '不相关'}，实际 ${r.predicted ? '相关' : '不相关'}）`);
    }
  }
}

async function seed() {
  const { prisma } = await import('../src/db.js');
  const alerts = await prisma.alert.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    include: { keyword: { select: { text: true } } },
  });
  const cases = alerts
    .filter((a) => a.keyword?.text && !a.isFake && a.title)
    .map((a, i) => ({
      id: `seed-${i + 1}`,
      keyword: a.keyword.text,
      title: a.title,
      snippet: a.snippet || '',
      source: a.source,
      expectRelevant: true,
      expectFake: false,
      note: `历史命中正样本（入库 ${new Date(a.createdAt).toISOString()}）`,
    }));
  const out = path.resolve(__dirname, '../src/ai/eval/seed-cases.json');
  await writeFile(out, JSON.stringify({ threshold: config.openrouter.relevanceThreshold, cases }, null, 2));
  console.log(`已导出 ${cases.length} 条正样本 → ${out}`);
  console.log('提示：请人工核对后，将负样本（expectRelevant:false，如「OpenClaw vs Claude Sonnet 4.6」）补充进 cases.json。');
}

const args = parseArgs(process.argv.slice(2));
if (args.seed) {
  seed().catch((e) => {
    console.error('导出失败:', e.message);
    process.exit(1);
  });
} else {
  run(args).catch((e) => {
    console.error('评估失败:', e.message);
    process.exit(1);
  });
}
