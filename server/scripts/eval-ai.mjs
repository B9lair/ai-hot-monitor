#!/usr/bin/env node
/**
 * AI 相关性判定离线评估脚本
 *
 * 用法（在 server 目录下执行）：
 *   node scripts/eval-ai.mjs                      # 全量跑金标准数据集（相关性 + 真伪）
 *   node scripts/eval-ai.mjs --threshold 0.7      # 指定相关性阈值
 *   node scripts/eval-ai.mjs --sweep              # 阈值扫描（复用已算出的分数，不额外调 AI）
 *   node scripts/eval-ai.mjs --repeat 3           # 稳定性：每条重复判定 3 次，观察翻转率
 *   node scripts/eval-ai.mjs --judge              # 额外用 AI 法官对摘要/理由打分
 *   node scripts/eval-ai.mjs --filter keyword=GPT-5
 *   node scripts/eval-ai.mjs --limit 5
 *   node scripts/eval-ai.mjs --verbose            # 逐条打印（默认只打印判错条目）
 *   node scripts/eval-ai.mjs --concurrency 6      # AI 调用并发（默认 4）
 *   node scripts/eval-ai.mjs --no-save            # 不写基线快照
 *   node scripts/eval-ai.mjs --seed               # 从历史 Alert 导出正样本
 *
 * 产出：
 *   - 相关性：Accuracy / Precision / Recall / F1（附 Wilson 95% 置信区间与混淆矩阵）
 *   - 真伪：准确率（仅统计标注了 expectFake 的用例）
 *   - 稳定性：--repeat 时的判定翻转率
 *   - 成本：调用次数 / 重试 / 失败 / token / 耗时
 *   - 基线快照：src/ai/eval/results/<时间戳>.json（带 prompt 版本，可跨版本对比）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyRelevance,
  checkAuthenticity,
  isRelevantHit,
  judgeQuality,
  getAiStats,
  resetAiStats,
  PROMPT_VERSION,
} from '../src/ai/openrouter.ts';
import { config, hasAI } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.resolve(__dirname, '../src/ai/eval/cases.json');
const RESULTS_DIR = path.resolve(__dirname, '../src/ai/eval/results');

function parseArgs(argv) {
  const a = {
    threshold: config.openrouter.relevanceThreshold,
    judge: false,
    seed: false,
    sweep: false,
    verbose: false,
    save: true,
    filter: '',
    limit: 0,
    repeat: 1,
    concurrency: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--threshold') a.threshold = Number(argv[++i]);
    else if (x === '--judge') a.judge = true;
    else if (x === '--seed') a.seed = true;
    else if (x === '--sweep') a.sweep = true;
    else if (x === '--verbose') a.verbose = true;
    else if (x === '--no-save') a.save = false;
    else if (x === '--filter') a.filter = argv[++i];
    else if (x === '--limit') a.limit = Number(argv[++i]);
    else if (x === '--repeat') a.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (x === '--concurrency') a.concurrency = Math.max(1, Number(argv[++i]) || 4);
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

/** Wilson 区间：小样本下比正态近似更可靠 */
function wilson(successes, total, z = 1.96) {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/** 只统计成功拿到相关性结果的样本；失败条数单独报出，不污染指标 */
function usableRows(rows) {
  return rows.filter((r) => r && r.rel);
}

function computeMetrics(rows, threshold) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const usable = usableRows(rows);
  for (const r of usable) {
    const exp = Boolean(r.c.expectRelevant);
    const pred = isRelevantHit(r.rel, threshold);
    if (exp && pred) tp++;
    else if (exp && !pred) fn++;
    else if (!exp && pred) fp++;
    else tn++;
  }
  const total = usable.length;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { total, failed: rows.length - total, tp, fp, fn, tn, accuracy, precision, recall, f1 };
}

/** F1 的 bootstrap 置信区间（重采样，反映小样本不确定性） */
function bootstrapF1(rows, threshold, iterations = 1000) {
  const usable = usableRows(rows);
  if (usable.length === 0) return [0, 0];
  const out = [];
  for (let i = 0; i < iterations; i++) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < usable.length; j++) {
      const r = usable[Math.floor(Math.random() * usable.length)];
      const exp = Boolean(r.c.expectRelevant);
      const pred = isRelevantHit(r.rel, threshold);
      if (exp && pred) tp++;
      else if (!exp && pred) fp++;
      else if (exp && !pred) fn++;
    }
    const p = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    out.push(p + rec ? (2 * p * rec) / (p + rec) : 0);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(iterations * 0.025)], out[Math.floor(iterations * 0.975)]];
}

function computeFakeMetrics(rows) {
  const subset = rows.filter((r) => r.fake && typeof r.c.expectFake === 'boolean');
  if (subset.length === 0) return null;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of subset) {
    const exp = Boolean(r.c.expectFake);
    const pred = Boolean(r.fake.isFake);
    if (exp && pred) tp++;
    else if (!exp && pred) fp++;
    else if (exp && !pred) fn++;
    else tn++;
  }
  const total = subset.length;
  return { total, tp, fp, fn, tn, accuracy: (tp + tn) / total };
}

/** 阈值扫描：复用已算出的 relevance 分数，不额外调用 AI */
function sweepThresholds(rows, from = 0.05, to = 0.95, step = 0.05) {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    const m = computeMetrics(rows, Number(t.toFixed(2)));
    out.push({ threshold: Number(t.toFixed(2)), ...m });
  }
  return out;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
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

  const judgeModel = config.openrouter.judgeModel || config.openrouter.model;
  console.log('\n=== AI 相关性判定评估 ===');
  console.log(
    `模型：${config.openrouter.model}  阈值：${args.threshold}  用例数：${cases.length}  prompt：${PROMPT_VERSION}  并发：${args.concurrency}`,
  );
  if (args.repeat > 1) console.log(`稳定性重复次数：${args.repeat}`);
  if (args.judge) {
    console.log(`法官模型：${judgeModel}`);
    // 自评偏差提示：法官与筛选模型相同意味着「自己评自己」，分数只能当格式检查
    if (judgeModel === config.openrouter.model) {
      console.warn(
        '⚠ 法官模型与筛选模型相同（未配置 OPENROUTER_JUDGE_MODEL），存在自评偏差，法官分仅供参考。',
      );
    }
  }
  console.log('');

  resetAiStats();
  const startedAt = Date.now();

  const rows = await mapLimit(cases, args.concurrency, async (c) => {
    const item = { title: c.title, snippet: c.snippet || '', source: c.source };
    // 单条用例失败（模型返回损坏 JSON 等）不应中断整轮评估，逐条记录错误继续跑
    const row = { c, item, rel: null, repeats: [], fake: null, judge: null, errors: [] };

    // 相关性判定（--repeat > 1 时重复采样，用于观察判定稳定性）
    try {
      for (let i = 0; i < args.repeat; i++) row.repeats.push(await verifyRelevance(c.keyword, item));
      row.rel = row.repeats[0];
    } catch (err) {
      row.errors.push(`相关性: ${err.message}`);
    }

    // 真伪判定：仅对标注了 expectFake 的用例调用，模拟线上「先相关、后真伪」的链路
    if (typeof c.expectFake === 'boolean') {
      try {
        row.fake = await checkAuthenticity(c.keyword, item);
      } catch (err) {
        row.errors.push(`真伪: ${err.message}`);
      }
    }

    // AI 法官（可选，依赖相关性结果）
    if (args.judge && row.rel) {
      try {
        row.judge = await judgeQuality(c.keyword, item, row.rel);
      } catch (err) {
        row.errors.push(`法官: ${err.message}`);
      }
    }

    return row;
  });

  const elapsedMs = Date.now() - startedAt;

  // 逐条输出（默认只打印判错条目，--verbose 打印全部）
  const m = computeMetrics(rows, args.threshold);
  for (const r of rows) {
    if (!r.rel) {
      console.log(`[!] ${r.c.id}「${r.c.keyword}」判定失败：${r.errors.join(' | ')}`);
      console.log('');
      continue;
    }
    const predicted = isRelevantHit(r.rel, args.threshold);
    const ok = predicted === Boolean(r.c.expectRelevant);
    if (!args.verbose && ok) continue;
    const mark = ok ? '✓' : '✗';
    console.log(`[${mark}] ${r.c.id}  「${r.c.keyword}」  ${r.c.source}`);
    console.log(`      标题: ${r.c.title}`);
    console.log(
      `      相关度 ${r.rel.relevance.toFixed(2)} → 判定 ${predicted ? '相关' : '不相关'}（期望 ${r.c.expectRelevant ? '相关' : '不相关'}）`,
    );
    if (r.fake && typeof r.c.expectFake === 'boolean') {
      const fakeOk = Boolean(r.fake.isFake) === Boolean(r.c.expectFake);
      console.log(
        `      真伪 ${r.fake.isFake ? '疑似假冒' : '真实'}（期望 ${r.c.expectFake ? '疑似假冒' : '真实'}）${fakeOk ? '' : ' ✗'}`,
      );
    }
    if (args.repeat > 1) {
      const vals = r.repeats.map((x) => x.relevance);
      const decisions = new Set(r.repeats.map((x) => isRelevantHit(x, args.threshold)));
      console.log(
        `      重复 ${args.repeat} 次: [${vals.map((v) => v.toFixed(2)).join(', ')}] 极差 ${(Math.max(...vals) - Math.min(...vals)).toFixed(2)}${decisions.size > 1 ? '  ⚠ 判定翻转' : ''}`,
      );
    }
    if (r.judge) {
      console.log(`      法官: 摘要 ${r.judge.summaryScore}/5 · 理由 ${r.judge.reasonScore}/5 — ${r.judge.comment}`);
    }
    if (!ok || !args.verbose) {
      console.log(`      摘要: ${r.rel.summary}`);
      console.log(`      理由: ${r.rel.relevanceReason}`);
    }
    console.log('');
  }

  // ===== 汇总 =====
  const f1Ci = bootstrapF1(rows, args.threshold);
  const accCi = wilson(m.tp + m.tn, m.total);

  console.log('=== 相关性判定汇总 ===');
  console.log(
    `样本 ${m.total}${m.failed ? `（另有 ${m.failed} 条判定失败未计入）` : ''} · 正确 ${m.tp + m.tn} · 错误 ${m.fp + m.fn}`,
  );
  console.log(`准确率 Accuracy   ${pct(m.accuracy)}  [95% CI ${pct(accCi[0])}, ${pct(accCi[1])}]`);
  console.log(`精确率 Precision  ${pct(m.precision)}  (TP=${m.tp} FP=${m.fp})`);
  console.log(`召回率 Recall     ${pct(m.recall)}  (FN=${m.fn})`);
  console.log(`F1               ${m.f1.toFixed(3)}  [95% CI ${f1Ci[0].toFixed(3)}, ${f1Ci[1].toFixed(3)}]`);
  console.log(`混淆矩阵         TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`);

  const f = computeFakeMetrics(rows);
  if (f) {
    console.log('\n=== 真伪判定 ===');
    console.log(
      `准确率 ${pct(f.accuracy)} (${f.tp + f.tn}/${f.total})  ·  漏判(${f.fn}) 误伤(${f.fp})`,
    );
  }

  let sweep = null;
  if (args.sweep) {
    sweep = sweepThresholds(rows);
    console.log('\n=== 阈值扫描（复用本次分数，不额外调用 AI）===');
    console.log('阈值    精确率   召回率   F1      准确率');
    for (const s of sweep) {
      console.log(
        `${s.threshold.toFixed(2)}    ${pct(s.precision).padStart(6)}  ${pct(s.recall).padStart(6)}  ${s.f1.toFixed(3)}   ${pct(s.accuracy)}`,
      );
    }
    const best = sweep.reduce((a, b) => (b.f1 > a.f1 ? b : a));
    // precision 优先：本项目更怕噪音误报，取满足精确率最高的最小阈值
    const precSafe = sweep.filter((s) => s.precision >= 0.95);
    console.log(
      `\n最优 F1 阈值 ${best.threshold.toFixed(2)} → F1 ${best.f1.toFixed(3)} / 精确率 ${pct(best.precision)} / 召回率 ${pct(best.recall)}`,
    );
    if (precSafe.length) {
      const chosen = precSafe[0];
      console.log(
        `精确率优先（≥95%）建议阈值 ${chosen.threshold.toFixed(2)} → 精确率 ${pct(chosen.precision)} / 召回率 ${pct(chosen.recall)}`,
      );
    }
  }

  let stability = null;
  if (args.repeat > 1) {
    const usable = usableRows(rows);
    let flipped = 0;
    let maxSpread = 0;
    for (const r of usable) {
      const decisions = new Set(r.repeats.map((x) => isRelevantHit(x, args.threshold)));
      if (decisions.size > 1) flipped++;
      const vals = r.repeats.map((x) => x.relevance);
      maxSpread = Math.max(maxSpread, Math.max(...vals) - Math.min(...vals));
    }
    stability = {
      repeat: args.repeat,
      flipped,
      flipRate: usable.length ? flipped / usable.length : 0,
      maxSpread,
    };
    console.log('\n=== 判定稳定性 ===');
    console.log(
      `重复 ${args.repeat} 次：判定翻转 ${flipped}/${usable.length}（${pct(stability.flipRate)}）· 相关度最大极差 ${maxSpread.toFixed(2)}`,
    );
  }

  let judgeSummary = null;
  if (args.judge && rows.some((r) => r.judge)) {
    const sj = rows.filter((r) => r.judge);
    const avgS = sj.reduce((s, r) => s + r.judge.summaryScore, 0) / sj.length;
    const avgR = sj.reduce((s, r) => s + r.judge.reasonScore, 0) / sj.length;
    judgeSummary = { avgSummaryScore: avgS, avgReasonScore: avgR, judgeModel };
    console.log('\n=== AI 法官打分 ===');
    console.log(`摘要平均 ${avgS.toFixed(2)}/5 · 理由平均 ${avgR.toFixed(2)}/5（法官模型：${judgeModel}）`);
    if (judgeModel === config.openrouter.model) {
      console.log('提示：法官与筛选模型相同，该分数存在自评偏差，建议配置独立的 OPENROUTER_JUDGE_MODEL。');
    }
  }

  // ===== 成本 =====
  const stats = getAiStats();
  const totalTokens = stats.promptTokens + stats.completionTokens;
  console.log('\n=== 调用成本 ===');
  console.log(
    `调用 ${stats.calls} 次 · 重试 ${stats.retries} · 失败 ${stats.failures} · token ${totalTokens}（输入 ${stats.promptTokens} / 输出 ${stats.completionTokens}）`,
  );
  console.log(
    `耗时 ${(elapsedMs / 1000).toFixed(1)}s（AI 请求累计 ${(stats.totalMs / 1000).toFixed(1)}s）· 平均 ${stats.calls ? (totalTokens / stats.calls).toFixed(0) : 0} token/次`,
  );

  const wrong = rows
    .filter((r) => r.rel && isRelevantHit(r.rel, args.threshold) !== Boolean(r.c.expectRelevant))
    .map((r) => ({
      id: r.c.id,
      keyword: r.c.keyword,
      title: r.c.title,
      source: r.c.source,
      expectRelevant: r.c.expectRelevant,
      relevance: r.rel.relevance,
      matchType: r.rel.matchType,
      note: r.c.note || '',
    }));

  if (wrong.length) {
    console.log('\n=== 判错用例 ===');
    for (const w of wrong) {
      console.log(
        `- ${w.id}「${w.keyword}」相关度 ${w.relevance.toFixed(2)}，期望 ${w.expectRelevant ? '相关' : '不相关'}｜${w.title}`,
      );
    }
  }

  // ===== 基线快照 =====
  if (args.save) {
    const report = {
      timestamp: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      model: config.openrouter.model,
      judgeModel: args.judge ? judgeModel : null,
      threshold: args.threshold,
      concurrency: args.concurrency,
      dataset: { total: raw.cases?.length || 0, evaluated: cases.length, version: raw.version || '' },
      relevance: compactMetrics(m),
      relevanceCi: { accuracy: accCi, f1: f1Ci },
      fake: f ? compactMetrics(f) : null,
      sweep: sweep ? sweep.map(compactMetrics) : null,
      stability,
      judge: judgeSummary,
      cost: { ...stats, totalTokens, elapsedMs },
      wrong,
      failures: rows
        .filter((r) => !r.rel || r.errors.length)
        .map((r) => ({ id: r.c.id, keyword: r.c.keyword, title: r.c.title, errors: r.errors })),
    };
    await mkdir(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(RESULTS_DIR, `${stamp}.json`);
    await writeFile(outFile, JSON.stringify(report, null, 2));
    console.log(`\n基线快照已保存：${path.relative(process.cwd(), outFile)}`);
  }
}

function compactMetrics(m) {
  // 真伪指标只有 total/tp/fp/fn/tn/accuracy，没有 precision 等字段，
  // 所以这里必须容忍 undefined（否则保存基线时会抛 toFixed of undefined）
  const round = (x) =>
    typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(4)) : undefined;
  return {
    total: m.total,
    tp: m.tp,
    fp: m.fp,
    fn: m.fn,
    tn: m.tn,
    accuracy: round(m.accuracy),
    precision: round(m.precision),
    recall: round(m.recall),
    f1: round(m.f1),
    threshold: m.threshold,
  };
}

async function seed() {
  const { prisma } = await import('../src/db.js');
  const alerts = await prisma.alert.findMany({
    take: 200,
    orderBy: { createdAt: 'desc' },
    include: { keyword: { select: { text: true } } },
  });
  // 去重：同标题只保留一条，避免导出结果里全是同一个重复命中
  const seen = new Set();
  const cases = [];
  for (const a of alerts) {
    if (!a.keyword?.text || a.isFake || !a.title) continue;
    const key = a.title.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({
      id: `seed-${cases.length + 1}`,
      keyword: a.keyword.text,
      title: a.title,
      snippet: a.snippet || '',
      source: a.source,
      expectRelevant: true,
      expectFake: false,
      note: `历史命中正样本（入库 ${new Date(a.createdAt).toISOString()}）`,
    });
  }
  const out = path.resolve(__dirname, '../src/ai/eval/seed-cases.json');
  await writeFile(out, JSON.stringify({ threshold: config.openrouter.relevanceThreshold, cases }, null, 2));
  console.log(`已导出 ${cases.length} 条去重正样本 → ${out}`);
  console.log('提示：请人工核对后合并进 cases.json（注意保留困难负样本，避免只剩正样本）。');
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
