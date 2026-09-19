#!/usr/bin/env node
/**
 * 启动冒烟测试：真正拉起服务进程 → 请求关键接口 → 校验响应 → 关闭进程。
 *
 * 用途：验证「入口 → 路由 → 服务层 → AI 层（TypeScript）」整条导入链在
 * Node 原生类型擦除下可正常加载，且服务能监听端口、响应请求。
 *
 * 运行：npm run smoke
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../src/config.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://localhost:${config.port}`;
const START_TIMEOUT_MS = 20000;

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: SERVER_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => {
  stdout += d.toString();
});
child.stderr.on('data', (d) => {
  stderr += d.toString();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待服务就绪 */
async function waitReady() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 尚未监听，继续重试 */
    }
    await sleep(300);
  }
  return false;
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? `  ${detail}` : ''}`);
};

let exitCode = 0;
try {
  const ready = await waitReady();
  if (!ready) {
    console.error('\n✖ 服务未能在超时内就绪');
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout.trim());
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr.trim());
    if (/EADDRINUSE/.test(stdout + stderr)) {
      console.error(`提示：端口 ${config.port} 已被占用，请先关闭正在运行的服务后重试。`);
    }
    process.exit(1);
  }
  check('服务启动并监听端口', true, `:${config.port}`);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check('GET /api/health', health?.ok === true, JSON.stringify(health));

  const status = await fetch(`${BASE}/api/status`).then((r) => r.json());
  check(
    'GET /api/status（含 AI / 阈值 / 数据源）',
    typeof status?.hasAI === 'boolean' && Array.isArray(Object.keys(status?.sources || {})),
    `hasAI=${status?.hasAI} model=${status?.model} 阈值=${status?.relevanceThreshold} 源=${Object.keys(status?.sources || {}).length} 个`,
  );

  const alerts = await fetch(`${BASE}/api/alerts?page=1&pageSize=1`).then((r) => r.json());
  check(
    'GET /api/alerts（分页结构）',
    Array.isArray(alerts?.list) && typeof alerts?.total === 'number',
    `total=${alerts?.total} pageSize=${alerts?.pageSize}`,
  );

  const stats = await fetch(`${BASE}/api/stats`).then((r) => r.json());
  check('GET /api/stats', typeof stats?.realAlerts === 'number', JSON.stringify(stats));

  const me = await fetch(`${BASE}/api/auth/me`).then((r) => r.json());
  check('GET /api/auth/me（未登录返回 user:null）', 'user' in me, JSON.stringify(me));
} catch (err) {
  console.error('冒烟测试异常:', err.message);
  exitCode = 1;
} finally {
  child.kill();
  await sleep(300);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过`);
if (failed.length) {
  console.error('失败项：' + failed.map((f) => f.name).join('、'));
  exitCode = 1;
}
process.exit(exitCode);
