#!/usr/bin/env node
/**
 * 项目量化脚本：把「工程规模 / 数据分布 / 过滤漏斗」变成可复现的数字。
 *
 * 用法（在 server 目录下执行）：
 *   node scripts/quantify.mjs                # 默认：代码规模 + 数据库统计
 *   node scripts/quantify.mjs --code         # 仅代码规模
 *   node scripts/quantify.mjs --db           # 仅数据库统计
 *   node scripts/quantify.mjs --funnel "AI"  # 仅过滤漏斗实测（联网打真实源，不调 AI）
 *   node scripts/quantify.mjs --all          # 全部（含漏斗，默认关键词 AI）
 *
 * 说明：--db / --funnel 会按需动态加载模块，缺少数据库或网络时其余部分仍可单独运行。
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '..');
const CLIENT_SRC = path.resolve(SERVER, '../client/src');

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
const line = (t) => console.log(`\n=== ${t} ===`);
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// ============================== 代码规模 ==============================
const CODE_EXT = new Set(['.js', '.jsx', '.mjs', '.prisma', '.css']);

async function walk(dir, acc = { files: 0, lines: 0, byExt: {} }) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, acc);
      continue;
    }
    const ext = path.extname(e.name);
    if (!CODE_EXT.has(ext)) continue;
    const text = await readFile(p, 'utf8');
    const n = text.length ? text.split('\n').length : 0;
    acc.files += 1;
    acc.lines += n;
    acc.byExt[ext] = acc.byExt[ext] || { files: 0, lines: 0 };
    acc.byExt[ext].files += 1;
    acc.byExt[ext].lines += n;
  }
  return acc;
}

async function reportCode() {
  line('A1. 代码规模');
  const serverCode = await walk(path.join(SERVER, 'src'));
  const scriptsCode = await walk(path.join(SERVER, 'scripts'));
  const clientCode = await walk(CLIENT_SRC);
  const schema = await readFile(path.join(SERVER, 'prisma/schema.prisma'), 'utf8');
  const schemaLines = schema.split('\n').length;

  console.log(`${pad('server/src', 15)}: ${serverCode.files} 文件 / ${serverCode.lines} 行`);
  console.log(`${pad('server/scripts', 15)}: ${scriptsCode.files} 文件 / ${scriptsCode.lines} 行`);
  console.log(`${pad('client/src', 15)}: ${clientCode.files} 文件 / ${clientCode.lines} 行`);
  console.log(`${pad('schema.prisma', 15)}: 1 文件 / ${schemaLines} 行`);
  console.log(
    `${pad('合计', 15)}: ${serverCode.files + clientCode.files} 文件 / ${serverCode.lines + clientCode.lines} 行（不含 scripts/schema）`,
  );

  line('A2. 结构规模');
  let endpoints = 0;
  for (const f of await readdir(path.join(SERVER, 'src/routes'))) {
    const t = await readFile(path.join(SERVER, 'src/routes', f), 'utf8');
    const n = (t.match(/router\.(get|post|patch|delete|put)\s*\(/g) || []).length;
    endpoints += n;
    console.log(`  routes/${pad(f, 12)} ${rpad(n, 3)} 个端点`);
  }
  console.log(`  ${pad('API 端点合计', 20)} ${rpad(endpoints, 3)}`);

  const models = (schema.match(/^model\s+(\w+)/gm) || []).map((s) => s.replace('model ', ''));
  console.log(`  ${pad('数据表', 20)} ${rpad(models.length, 3)}  (${models.join(', ')})`);

  const sources = (await readdir(path.join(SERVER, 'src/sources'))).filter((f) => f.endsWith('.js'));
  console.log(`  ${pad('数据源适配器文件', 20)} ${rpad(sources.length, 3)}`);

  const envExample = await readFile(path.join(SERVER, '.env.example'), 'utf8').catch(() => '');
  const envVars = envExample.split('\n').filter((l) => /^[A-Z0-9_]+\s*=/.test(l.trim()));
  console.log(`  ${pad('可配置项(.env.example)', 20)} ${rpad(envVars.length, 3)}`);
}

// ============================== 数据库统计 ==============================
const COVERAGE_FIELDS = [
  'relevance',
  'hotScore',
  'metrics',
  'publishedAt',
  'author',
  'relevanceReason',
  'normalizedUrl',
];
const DAY = 86400_000;

async function reportDb() {
  const { prisma } = await import('../src/db.js');
  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);

  line('B1. 数据总览');
  const total = await prisma.alert.count();
  const real = await prisma.alert.count({ where: { isFake: false } });
  const fake = await prisma.alert.count({ where: { isFake: true } });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  console.log(`Alert 累计        : ${total}（真实 ${real} / 疑似假冒 ${fake}，假冒占 ${pct(fake, total)}）`);
  console.log(`今日新增          : ${await prisma.alert.count({ where: { createdAt: { gte: todayStart } } })}`);
  console.log(`近 24h / 近 7 天  : ${await prisma.alert.count({ where: { createdAt: { gte: hoursAgo(24) } } })} / ${await prisma.alert.count({ where: { createdAt: { gte: hoursAgo(24 * 7) } } })}`);
  console.log(`Keyword           : ${await prisma.keyword.count()}（启用 ${await prisma.keyword.count({ where: { enabled: true } })}）`);
  console.log(`Favorite          : ${await prisma.favorite.count()}`);
  console.log(`User              : ${await prisma.user.count()}（开启邮件 ${await prisma.user.count({ where: { notifyEmail: true } })}）`);
  console.log(`LoginToken        : ${await prisma.loginToken.count()}（已使用 ${await prisma.loginToken.count({ where: { usedAt: { not: null } } })}）`);
  console.log(`Session           : ${await prisma.session.count()}`);

  const span = await prisma.alert.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } });
  console.log(`时间跨度          : ${span._min.createdAt?.toISOString().slice(0, 10)} ~ ${span._max.createdAt?.toISOString().slice(0, 10)}`);

  line('B2. 通知记录');
  const groups = await prisma.notification.groupBy({ by: ['channel', 'status'], _count: { _all: true } });
  for (const g of groups) console.log(`  ${pad(`${g.channel}/${g.status}`, 16)} ${rpad(g._count._all, 4)}`);
  const sent = await prisma.notification.count({ where: { channel: 'email', status: 'sent' } });
  const failed = await prisma.notification.count({ where: { channel: 'email', status: 'failed' } });
  console.log(`  邮件成功率      ${pct(sent, sent + failed)}（成功 ${sent} / 失败 ${failed}）`);
  const digest = await prisma.notification.aggregate({
    where: { channel: 'email' },
    _avg: { itemCount: true },
    _sum: { itemCount: true },
  });
  console.log(`  聚合平均条数    ${Number(digest._avg.itemCount || 0).toFixed(1)}（累计聚合 ${digest._sum.itemCount || 0} 条）`);

  const failRows = await prisma.notification.findMany({
    where: { channel: 'email', status: 'failed' },
    select: { error: true },
  });
  if (failRows.length) {
    const counter = new Map();
    for (const f of failRows) {
      const k = String(f.error || 'unknown').slice(0, 100);
      counter.set(k, (counter.get(k) || 0) + 1);
    }
    console.log('  失败原因：');
    for (const [k, v] of counter) console.log(`    x${v}  ${k}`);
  }

  line('B3. 各数据源命中分布');
  const bySource = await prisma.alert.groupBy({
    by: ['source'],
    _count: { _all: true },
    _avg: { relevance: true, hotScore: true },
  });
  bySource.sort((a, b) => b._count._all - a._count._all);
  let fakeSum = 0;
  for (const s of bySource) {
    const fakeN = await prisma.alert.count({ where: { source: s.source, isFake: true } });
    fakeSum += fakeN;
    console.log(
      `  ${pad(s.source, 12)} 命中 ${rpad(s._count._all, 4)}  占 ${rpad(pct(s._count._all, total), 6)}  假冒 ${rpad(fakeN, 3)}  平均相关度 ${(s._avg.relevance ?? 0).toFixed(2)}  平均热度 ${(s._avg.hotScore ?? 0).toFixed(1)}`,
    );
  }
  console.log(`  实际覆盖数据源数: ${bySource.length}`);

  line('B4. 字段覆盖率');
  for (const [label, where] of [
    ['近 24 小时', { createdAt: { gte: hoursAgo(24) } }],
    ['近 7 天', { createdAt: { gte: hoursAgo(24 * 7) } }],
    ['全量', {}],
  ]) {
    const t = await prisma.alert.count({ where });
    let sum = 0;
    const parts = [];
    for (const f of COVERAGE_FIELDS) {
      const n = await prisma.alert.count({ where: { ...where, [f]: { not: null } } });
      sum += n;
      parts.push(`${f} ${pct(n, t)}`);
    }
    console.log(`  ${pad(label, 10)}（${t} 条）平均 ${rpad(pct(sum / COVERAGE_FIELDS.length, t), 6)}`);
    console.log(`    ${parts.join('  ')}`);
  }

  line('B5. 均值指标');
  const agg = await prisma.alert.aggregate({ _avg: { confidence: true, relevance: true, hotScore: true } });
  console.log(`  平均置信度 ${(agg._avg.confidence ?? 0).toFixed(3)}   平均相关度 ${(agg._avg.relevance ?? 0).toFixed(3)}   平均热度分 ${(agg._avg.hotScore ?? 0).toFixed(1)}`);

  line('B6. 按天命中量（近 7 天）');
  const recent = await prisma.alert.findMany({
    where: { createdAt: { gte: hoursAgo(24 * 7) } },
    select: { createdAt: true },
  });
  const buckets = new Map();
  for (const r of recent) {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    buckets.set(d, (buckets.get(d) || 0) + 1);
  }
  for (const d of [...buckets.keys()].sort()) {
    console.log(`  ${d}  ${rpad(buckets.get(d), 4)}  ${'#'.repeat(Math.min(60, buckets.get(d)))}`);
  }

  await prisma.$disconnect();
}

// ============================== 过滤漏斗 ==============================
const FUNNEL_SOURCES = [
  ['twitter', 'Twitter', 'searchTwitter'],
  ['hackernews', 'HackerNews', 'searchHackerNews'],
  ['bilibili', 'B站', 'searchBilibili'],
  ['weibo', '微博', 'searchWeibo'],
  ['github', 'GitHub', 'searchGithub'],
  ['zhihu', '知乎', 'searchZhihu'],
  ['reddit', 'Reddit', 'searchReddit'],
  ['v2ex', 'V2EX', 'searchV2ex'],
];

async function reportFunnel(keyword) {
  const { config } = await import('../src/config.js');
  const filter = await import('../src/sources/filter.js');
  const websearch = await import('../src/sources/websearch.js');

  const s = config.sources;
  const collect = Math.max(s.collectLimit, s.perSourceLimit);

  const tasks = [];
  for (const [key, name, fn] of FUNNEL_SOURCES) {
    const mod = await import(`../src/sources/${key}.js`);
    tasks.push({ key, name, run: () => mod[fn](keyword, collect) });
  }
  tasks.push({ key: null, name: '搜索引擎', run: () => websearch.searchMultiEngines(keyword, undefined, collect) });

  const active = tasks.filter((t) => (t.key ? s.enabled[t.key] : true));
  line(`C. 过滤漏斗实测（关键词「${keyword}」，每源采集上限 ${collect}，启用源 ${active.length}）`);

  const t0 = Date.now();
  const settled = await Promise.allSettled(active.map((t) => t.run()));
  const cost = Date.now() - t0;

  const raw = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const t = active[i];
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      raw.push(...r.value);
      const withMetrics = r.value.filter((x) => x.metrics).length;
      const withPub = r.value.filter((x) => x.publishedAt).length;
      console.log(
        `  ${pad(t.name, 11)} 采集 ${rpad(r.value.length, 3)}  带指标 ${rpad(withMetrics, 3)}  带发布时间 ${rpad(withPub, 3)}`,
      );
    } else {
      console.log(`  ${pad(t.name, 11)} 采集   0  (失败: ${r.reason?.message || 'unknown'})`);
    }
  }
  console.log(`  采集合计 ${raw.length} 条，并行耗时 ${cost}ms`);

  const basic = filter.applyBasicFilter(raw, s);
  const quality = filter.applyQualityFilter(basic, { ...s, perSourceLimit: s.perSourceLimit });
  console.log(`  第一层基础过滤后 ${basic.length} 条（去掉 ${raw.length - basic.length}：格式/去重/时间窗口）`);
  console.log(`  第二层质量过滤后 ${quality.length} 条（去掉 ${basic.length - quality.length}：门槛/每源保留 ${s.perSourceLimit}）`);

  const bySrc = new Map();
  for (const q of quality) bySrc.set(q.source, (bySrc.get(q.source) || 0) + 1);
  console.log(`  入 AI 校验前源分布：${[...bySrc.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);

  const saved = raw.length ? ((raw.length - quality.length) / raw.length) * 100 : 0;
  console.log(`  漏斗压缩率 ${raw.length} → ${basic.length} → ${quality.length}（压缩 ${saved.toFixed(1)}%）`);
  console.log(`  AI 调用量：${raw.length} 次 → ${quality.length} 次，节省 ${saved.toFixed(1)}%`);
}

// ============================== 入口 ==============================
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const funnelIdx = argv.indexOf('--funnel');
const funnelKeyword = funnelIdx >= 0 ? argv[funnelIdx + 1] || 'AI' : null;

const runCode = has('--code') || has('--all');
const runDb = has('--db') || has('--all');
const runFunnel = has('--all') || funnelIdx >= 0;
const noFlag = !has('--code') && !has('--db') && !has('--all') && funnelIdx < 0;

try {
  if (noFlag || runCode || runDb || runFunnel) {
    if (runCode || noFlag) await reportCode();
    if (runDb || noFlag) await reportDb();
    if (runFunnel) await reportFunnel(funnelKeyword || 'AI');
  } else {
    console.log('用法: node scripts/quantify.mjs [--code] [--db] [--funnel "关键词"] [--all]');
  }
} catch (err) {
  console.error('量化失败:', err.message);
  process.exit(1);
}
