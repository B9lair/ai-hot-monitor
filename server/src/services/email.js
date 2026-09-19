import { prisma } from '../db.js';
import { config, hasSMTP } from '../config.js';
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

// ===== 主题 =====
function buildSubject(alerts, { mode, part = 1, totalParts = 1 }) {
  let s;
  if (mode === 'daily') {
    s = `[AI热点监控] 今日热点汇总 · ${alerts.length} 条`;
  } else if (alerts.length === 1) {
    const a = alerts[0];
    s = `[AI热点监控] 【${a.keywordText || '关键词'}】有新动态 · ${a.source}`;
  } else {
    const kws = [...new Set(alerts.map((a) => a.keywordText).filter(Boolean))];
    const shown = kws.slice(0, 3).join('、');
    s = `[AI热点监控] ${alerts.length} 条新热点${kws.length ? `（${shown}${kws.length > 3 ? '等' : ''}）` : ''}`;
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
function renderAlertEmail(alerts, user, { mode, part, totalParts }) {
  const kws = new Set(alerts.map((a) => a.keywordText).filter(Boolean));
  const stat =
    mode === 'daily'
      ? `过去 24 小时共 ${alerts.length} 条热点${kws.size ? `，涉及 ${kws.size} 个关注范围` : ''}`
      : `本轮共 ${alerts.length} 条热点${kws.size ? `，涉及 ${kws.size} 个关注范围` : ''}`;

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

// ===== 幂等与配额 =====
async function isDuplicate(userId, batchKey) {
  if (!batchKey) return false;
  const hit = await prisma.notification.findFirst({ where: { userId, batchKey } });
  return Boolean(hit);
}

async function hourQuotaExceeded(userId) {
  const since = new Date(Date.now() - 3600_000);
  const count = await prisma.notification.count({
    where: { userId, channel: 'email', createdAt: { gte: since } },
  });
  return count >= config.email.maxPerHour;
}

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

// ===== 延后队列：免打扰 / 超配额时不丢弃，改为稍后补发 =====
const pendingByUser = new Map(); // userId -> { alerts, mode }
const MAX_PENDING_PER_USER = 200;

function deferForUser(userId, alerts, mode) {
  const cur = pendingByUser.get(userId) || { alerts: [], mode };
  const seen = new Set(cur.alerts.map((a) => a.id));
  for (const a of alerts) if (!seen.has(a.id)) cur.alerts.push(a);
  // 上限保护：超出只保留最近的部分
  if (cur.alerts.length > MAX_PENDING_PER_USER) {
    cur.alerts = cur.alerts.slice(-MAX_PENDING_PER_USER);
  }
  cur.mode = mode;
  pendingByUser.set(userId, cur);
}

/** 投递给单个用户（按 EMAIL_MAX_ITEMS 分批） */
async function deliverToUser(user, chunks, { mode, batchKey }) {
  for (let i = 0; i < chunks.length; i++) {
    const part = i + 1;
    const totalParts = chunks.length;
    const subject = buildSubject(chunks[i], { mode, part, totalParts });
    const res = await sendMail({
      to: user.email,
      subject,
      html: renderAlertEmail(chunks[i], user, { mode, part, totalParts }),
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
  }
}

// ===== 对外入口 =====
/**
 * 发送热点邮件（聚合成一封或分批）
 * @param {object[]} alerts 本轮命中（含 keywordText）
 * @param {{batchKey?:string, mode?:string, userIds?:string[]}} [opts] userIds 限定收件人
 */
export async function sendAlertEmails(alerts, { batchKey, mode = config.email.mode, userIds } = {}) {
  if (!hasSMTP()) return;
  const filtered = filterAlerts(alerts);
  if (!filtered.length) return;

  const chunks = chunkArray(filtered, config.email.maxItems);
  const users = await prisma.user.findMany({
    where: { notifyEmail: true, ...(userIds ? { id: { in: userIds } } : {}) },
  });

  // 指定了收件人但都不可收（未开启邮件）→ 不发
  if (!users.length && userIds) return;

  // 无用户 → 回退旧行为（发到全局 NOTIFY_EMAIL_TO）；该路径无用户可延后，免打扰时直接跳过
  if (!users.length) {
    if (!config.smtp.to.length) return;
    if (inQuietHours()) {
      console.log('[email] 处于免打扰时段，回退收件人邮件跳过');
      return;
    }
    for (let i = 0; i < chunks.length; i++) {
      const part = i + 1;
      const totalParts = chunks.length;
      const subject = buildSubject(chunks[i], { mode, part, totalParts });
      const res = await sendMail({
        to: config.smtp.to,
        subject,
        html: renderAlertEmail(chunks[i], null, { mode, part, totalParts }),
        text: renderAlertText(chunks[i], null, { part, totalParts }),
      });
      await recordEmail({ userId: null, recipient: config.smtp.to.join(','), subject, alerts: chunks[i], batchKey, res });
    }
    return;
  }

  const quiet = inQuietHours();
  for (const user of users) {
    if (await isDuplicate(user.id, batchKey)) continue;

    // 免打扰 / 超配额 → 暂缓，等 flushPendingEmails 补发（不丢弃）
    if (quiet || (await hourQuotaExceeded(user.id))) {
      deferForUser(user.id, filtered, mode);
      console.log(
        `[email] 用户 ${user.email} 暂缓 ${filtered.length} 条（${quiet ? '免打扰时段' : '已达每小时上限'}），稍后自动补发`,
      );
      continue;
    }

    await deliverToUser(user, chunks, { mode, batchKey });
  }
}

/**
 * 补发暂缓的邮件（由定时任务每分钟调用）。
 * 仍处于免打扰或仍超配额时保持暂缓，下轮再试。
 */
export async function flushPendingEmails() {
  if (!hasSMTP() || pendingByUser.size === 0) return;
  if (inQuietHours()) return;

  for (const [userId, item] of [...pendingByUser.entries()]) {
    if (await hourQuotaExceeded(userId)) continue;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.notifyEmail) {
      pendingByUser.delete(userId);
      continue;
    }

    try {
      const chunks = chunkArray(item.alerts, config.email.maxItems);
      const count = item.alerts.length;
      await deliverToUser(user, chunks, { mode: item.mode, batchKey: `pending:${userId}:${Date.now()}` });
      pendingByUser.delete(userId);
      console.log(`[email] 已补发用户 ${user.email} 暂缓的 ${count} 条`);
    } catch (err) {
      console.error('[email] 补发失败，保留待下次重试:', err.message);
    }
  }
}

/** 当前暂缓中的用户数（供状态排查） */
export const pendingEmailCount = () => pendingByUser.size;

/** 每日汇总：取近 24 小时命中发送（由定时任务在 EMAIL_DAILY_AT 调用） */
export async function sendDailyDigest() {
  const since = new Date(Date.now() - 86400_000);
  const alerts = await prisma.alert.findMany({
    where: { createdAt: { gte: since }, isFake: false },
    orderBy: { createdAt: 'desc' },
    include: { keyword: { select: { text: true } } },
  });
  const mapped = alerts.map((a) => ({ ...a, keywordText: a.keyword?.text }));
  await sendAlertEmails(mapped, { mode: 'daily', batchKey: `daily:${new Date().toISOString().slice(0, 10)}` });
}
