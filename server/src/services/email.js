import { prisma } from '../db.js';
import { config, hasSMTP, clampEmailIntervalMin } from '../config.js';
import { sendMail } from './mailer.js';
import { signUnsubscribe } from './auth.js';
import { baseUrl } from '../urls.js';

// ===== 展示工具 =====
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const truncate = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

function fmtCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

const pad = (n) => String(n).padStart(2, '0');
const fmtDateTime = (d) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
const fmtRel = (d) => {
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
};

// 互动指标：图标 + 展示顺序（每源取前 4 个）
const METRIC_META = {
  likes: '👍', retweets: '🔁', replyCount: '💬', quoteCount: '❝', views: '👁',
  followers: '👥', stars: '⭐', forks: '🍴', watchers: '👀', issues: '❗',
  points: '🔺', comments: '💬', coins: '🪙', favorites: '⭐', danmaku: '🎬',
  reposts: '🔁', shares: '🔗', upvoteRatio: '👍', score: '🔥', rank: '🏷',
};
const METRIC_ORDER = [
  'likes', 'retweets', 'replyCount', 'quoteCount', 'views', 'followers',
  'stars', 'forks', 'watchers', 'points', 'comments', 'coins', 'favorites',
  'danmaku', 'reposts', 'shares', 'score', 'upvoteRatio', 'issues', 'rank',
];

function renderMetrics(metricsJson) {
  let m = {};
  try {
    m = metricsJson ? JSON.parse(metricsJson) : {};
  } catch {
    return '';
  }
  const keys = METRIC_ORDER.filter((k) => m[k] != null).slice(0, 4);
  if (!keys.length) return '';
  return keys
    .map((k) => {
      const raw = m[k];
      const val = typeof raw === 'number' ? fmtCount(raw) : String(raw);
      return `${METRIC_META[k] || ''} ${esc(val)}`;
    })
    .join(' &nbsp;&nbsp; ');
}

// ===== 过滤与分批 =====
function filterAlerts(alerts) {
  return (alerts || []).filter((a) => {
    if (!a || a.isFake) return false;
    if (config.email.minRelevance && (a.relevance ?? 0) < config.email.minRelevance) return false;
    if (config.email.minHotScore && (a.hotScore ?? 0) < config.email.minHotScore) return false;
    return true;
  });
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 是否处于免打扰时段（默认未配置 → 恒为 false） */
function inQuietHours() {
  const q = config.email.quietHours;
  if (!q) return false;
  const h = new Date().getHours();
  return q.start <= q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

/** 间隔（分钟）→ 可读标签（60 → "1 小时"，1440 → "1 天"，90 → "90 分钟"） */
function formatDurationLabel(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return '1 小时';
  if (m % 1440 === 0) return `${m / 1440} 天`;
  if (m % 60 === 0) return `${m / 60} 小时`;
  return `${m} 分钟`;
}

// ===== 主题 =====
function buildSubject(alerts, { durationLabel, part = 1, totalParts = 1 }) {
  let s;
  if (alerts.length === 1) {
    const a = alerts[0];
    s = `[AI热点监控] 【${a.keywordText || '关键词'}】有新动态 · ${a.source}`;
  } else {
    const kws = [...new Set(alerts.map((a) => a.keywordText).filter(Boolean))];
    const shown = kws.slice(0, 3).join('、');
    s = `[AI热点监控] 近 ${durationLabel} ${alerts.length} 条新热点${kws.length ? `（${shown}${kws.length > 3 ? '等' : ''}）` : ''}`;
  }
  if (totalParts > 1) s += `（${part}/${totalParts}）`;
  return s;
}

// ===== 渲染 =====
function renderAlertBlock(a) {
  const metrics = renderMetrics(a.metrics);
  const meta = [
    a.author ? `作者 ${esc(a.author)}` : '',
    a.publishedAt ? `发布 ${fmtDateTime(a.publishedAt)}` : '',
    `入库 ${fmtRel(a.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6f2ec;border-radius:12px;margin-bottom:12px">
    <tr><td style="padding:16px 20px">
      <div style="font-size:12px;color:#37a678;font-weight:700;margin-bottom:8px">
        【${esc(a.keywordText || '')}】
        <span style="color:#94a3b8;font-weight:400"> ${esc(a.source || '')}</span>
        ${a.relevance != null ? `<span style="color:#0ea5e9;font-weight:400"> · 相关度 ${Math.round(a.relevance * 100)}%</span>` : ''}
        ${a.hotScore != null ? `<span style="color:#f59e0b;font-weight:400"> · 热度 ${Math.round(a.hotScore)}</span>` : ''}
      </div>
      <div style="font-size:16px;font-weight:700;line-height:1.5;margin-bottom:8px">
        <a href="${esc(a.url)}" target="_blank" style="color:#1e293b;text-decoration:none">${esc(truncate(a.title, 80))}</a>
      </div>
      ${a.summary ? `<div style="font-size:13px;color:#475569;line-height:1.7;margin-bottom:8px">AI总结：${esc(a.summary)}</div>` : ''}
      ${metrics ? `<div style="font-size:12px;color:#64748b;margin-bottom:8px">${metrics}</div>` : ''}
      <div style="font-size:11px;color:#94a3b8">
        ${meta} · <a href="${esc(a.url)}" target="_blank" style="color:#37a678;text-decoration:none;font-weight:700">查看原文 →</a>
      </div>
    </td></tr>
  </table>`;
}

/**
 * 渲染整封邮件
 * @param {object[]} alerts
 * @param {object|null} user 为 null 时表示无用户回退（无退订链接）
 */
function renderAlertEmail(alerts, user, { durationLabel, part, totalParts }) {
  const kws = new Set(alerts.map((a) => a.keywordText).filter(Boolean));
  const stat = `近 ${durationLabel} 共 ${alerts.length} 条热点${kws.size ? `，涉及 ${kws.size} 个关注范围` : ''}`;

  const unsub = user
    ? `${baseUrl()}/api/email/unsubscribe?token=${signUnsubscribe(user.id)}`
    : '';

  const footer = user
    ? `
      <div style="font-size:11px;color:#94a3b8;line-height:1.9">
        由 AI Hot Monitor 自动发送<br/>
        <a href="${baseUrl()}/?settings=notify" style="color:#94a3b8">管理通知偏好</a>
        ${unsub ? ` · <a href="${unsub}" style="color:#94a3b8">一键退订</a>` : ''}
      </div>`
    : `<div style="font-size:11px;color:#94a3b8">由 AI Hot Monitor 自动发送</div>`;

  return `
  <div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;background:#f4f9f6;padding:20px">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
      <tr><td style="background:#37a678;border-radius:14px 14px 0 0;padding:18px 22px;color:#fff">
        <div style="font-size:16px;font-weight:700">AI Hot Monitor · 热点雷达</div>
        <div style="font-size:12px;opacity:.9;margin-top:4px">${stat}${totalParts > 1 ? ` · 第 ${part}/${totalParts} 封` : ''}</div>
      </td></tr>
      <tr><td style="background:#f4f9f6;padding:16px 0">
        ${alerts.map(renderAlertBlock).join('')}
      </td></tr>
      <tr><td style="padding:4px 6px 12px">${footer}</td></tr>
    </table>
  </div>`;
}

function renderAlertText(alerts, user, { totalParts, part }) {
  const lines = alerts.map((a) => {
    const head = `【${a.keywordText || ''}】${a.source}${a.relevance != null ? ` · 相关度 ${Math.round(a.relevance * 100)}%` : ''}`;
    return [
      head,
      a.title,
      a.summary ? `AI总结：${a.summary}` : '',
      `原文：${a.url}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  const tail = user
    ? `\n\n—\n管理通知偏好：${baseUrl()}/?settings=notify\n一键退订：${baseUrl()}/api/email/unsubscribe?token=${signUnsubscribe(user.id)}`
    : '\n\n—\n由 AI Hot Monitor 自动发送';
  return `AI Hot Monitor · 热点雷达（${alerts.length} 条${totalParts > 1 ? `，第 ${part}/${totalParts} 封` : ''}）\n\n${lines.join('\n\n')}${tail}`;
}

// ===== 记录 =====
async function recordEmail({ userId, recipient, subject, alerts, batchKey, res }) {
  await prisma.notification
    .create({
      data: {
        type: 'alert',
        channel: 'email',
        title: subject,
        content: alerts.length === 1
          ? alerts[0].title
          : `${alerts.length} 条：${alerts[0].title}`,
        url: alerts[0]?.url || null,
        status: res.ok ? 'sent' : 'failed',
        error: res.ok ? null : res.error || null,
        userId: userId || null,
        recipient: recipient || null,
        itemCount: alerts.length,
        batchKey: batchKey || null,
      },
    })
    .catch(() => {});
}

// ===== 投递 =====
/** 投递单个用户的全部命中（按 EMAIL_MAX_ITEMS 分批）；全部成功返回 true */
async function deliverToUser(user, chunks, { durationLabel, batchKey }) {
  let allOk = true;
  for (let i = 0; i < chunks.length; i++) {
    const part = i + 1;
    const totalParts = chunks.length;
    const subject = buildSubject(chunks[i], { durationLabel, part, totalParts });
    const res = await sendMail({
      to: user.email,
      subject,
      html: renderAlertEmail(chunks[i], user, { durationLabel, part, totalParts }),
      text: renderAlertText(chunks[i], user, { part, totalParts }),
      headers: { unsubscribe: `${baseUrl()}/api/email/unsubscribe?token=${signUnsubscribe(user.id)}` },
    });
    await recordEmail({
      userId: user.id,
      recipient: user.email,
      subject,
      alerts: chunks[i],
      batchKey: totalParts > 1 && batchKey ? `${batchKey}:${part}` : batchKey,
      res,
    });
    if (!res.ok) allOk = false;
  }
  return allOk;
}

// ===== 汇总调度（按用户自定义间隔） =====

/** 查询某时间点之后的新增命中（已过滤 isFake 与邮件阈值），带关键词文本 */
async function queryAlertsSince(since) {
  const rows = await prisma.alert.findMany({
    where: { createdAt: { gt: since }, isFake: false },
    orderBy: { createdAt: 'desc' },
    include: { keyword: { select: { text: true } } },
  });
  return filterAlerts(rows.map((a) => ({ ...a, keywordText: a.keyword?.text })));
}

/** 推进用户「上次发送」基线（只在成功发送或空窗口时调用） */
async function advanceLastEmailAt(userId, t) {
  await prisma.user.update({ where: { id: userId }, data: { lastEmailAt: t } }).catch(() => {});
}

let digestRunning = false;

/**
 * 邮件汇总调度器入口（由定时任务每 tick 调用）。
 * 扫描所有 notifyEmail=true 的用户，对「距上次发送已满自身间隔」的用户，
 * 把「上次发送之后」的新增命中打包成一封发送。
 */
export async function processEmailDigests() {
  if (!hasSMTP() || digestRunning) return;
  digestRunning = true;
  try {
    const quiet = inQuietHours();
    const users = await prisma.user.findMany({ where: { notifyEmail: true } });
    for (const user of users) {
      try {
        await processUserDigest(user, quiet);
      } catch (err) {
        console.error(`[email] 用户 ${user.email} 汇总处理失败:`, err.message);
      }
    }
  } finally {
    digestRunning = false;
  }
}

/** 处理单个用户的汇总：判断是否到期 → 查询窗口内命中 → 打包发送 → 推进基线 */
async function processUserDigest(user, quiet) {
  const intervalMin = clampEmailIntervalMin(user.emailIntervalMin);
  const intervalMs = intervalMin * 60000;
  const now = Date.now();

  // 计算发送窗口起点：避免「从未发过」的存量用户补发历史（窗口最多回看一个间隔）
  let windowStart;
  if (user.lastEmailAt) {
    if (now - new Date(user.lastEmailAt).getTime() < intervalMs) return; // 未到期
    windowStart = user.lastEmailAt;
  } else {
    const createdAt = new Date(user.createdAt).getTime();
    if (now - createdAt < intervalMs) return; // 新用户尚未到首个间隔
    windowStart = new Date(Math.max(createdAt, now - intervalMs));
  }

  if (quiet) return; // 免打扰时段：跳过且不推进基线

  const alerts = await queryAlertsSince(windowStart);
  if (!alerts.length) {
    // 空窗口也推进基线，避免重复扫描同一段空区间
    await advanceLastEmailAt(user.id, new Date());
    return;
  }

  const chunks = chunkArray(alerts, config.email.maxItems);
  const durationLabel = formatDurationLabel(intervalMin);
  const batchKey = `digest:${user.id}:${new Date(windowStart).getTime()}`;
  const ok = await deliverToUser(user, chunks, { durationLabel, batchKey });
  if (ok) await advanceLastEmailAt(user.id, new Date());
  // 发送失败不推进基线，下个 tick 自动重试同一窗口
}

/** 当前是否正在执行汇总（供状态排查） */
export const isDigesting = () => digestRunning;
