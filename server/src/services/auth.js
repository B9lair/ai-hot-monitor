import crypto from 'crypto';
import { prisma } from '../db.js';
import { config, hasSMTP } from '../config.js';
import { sendMail } from './mailer.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ===== 登录申请限流（进程内，按 IP） =====
const ipHits = new Map(); // ip -> number[]（最近一小时的毫秒时间戳）

function hitIpLimit(ip) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= config.auth.maxLoginPerIpHour) {
    ipHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  ipHits.set(ip, arr);
  return false;
}

/** 清理过期登录令牌（签发时顺带执行，避免表无限增长） */
async function cleanupTokens() {
  await prisma.loginToken
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } } })
    .catch(() => {});
}

/**
 * 签发登录令牌并发送验证邮件。
 * @param {string} email
 * @param {string} ip
 * @param {string} base 链接基地址（由调用方按访问来源解析，见 src/urls.js）
 * @returns {Promise<{ok:boolean, sent:boolean, reason?:string}>}
 * 对外始终 ok=true（防枚举），sent 仅用于内部日志。
 */
export async function requestLogin(email, ip, base = '') {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: true, sent: false, reason: 'invalid_email' };
  }
  if (hitIpLimit(ip)) return { ok: true, sent: false, reason: 'ip_rate_limited' };
  if (!hasSMTP()) return { ok: true, sent: false, reason: 'smtp_not_configured' };

  const user = await prisma.user.upsert({
    where: { email: normalized },
    update: {},
    create: { email: normalized },
  });

  // 同邮箱冷却
  const last = await prisma.loginToken.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  const tooSoon =
    last && Date.now() - last.createdAt.getTime() < config.auth.resendCooldownSec * 1000;
  if (tooSoon) return { ok: true, sent: false, reason: 'cooldown' };

  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.loginToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + config.auth.tokenTtlMin * 60_000),
    },
  });

  const link = `${base}/api/auth/verify?token=${raw}`;
  const res = await sendLoginMail(normalized, link);
  cleanupTokens();
  return { ok: true, sent: res.ok, reason: res.ok ? undefined : res.error };
}

/**
 * 校验登录令牌（单次有效）。
 * @param {string} raw
 * @returns {Promise<{id:string,email:string}|null>}
 */
export async function consumeLoginToken(raw) {
  if (!raw) return null;
  const row = await prisma.loginToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;

  await prisma.loginToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.update({
    where: { id: row.userId },
    data: { lastLoginAt: new Date() },
  });
  return { id: user.id, email: user.email };
}

// ===== 退订令牌（无状态签名，无需登录） =====
export function signUnsubscribe(userId) {
  const sig = crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(`unsub:${userId}`)
    .digest('base64url');
  return `${userId}.${sig}`;
}

export function verifyUnsubscribe(token) {
  const [userId, sig] = String(token || '').split('.');
  if (!userId || !sig) return null;
  const expect = crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(`unsub:${userId}`)
    .digest('base64url');
  if (sig.length !== expect.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)) ? userId : null;
}

/** 发送登录验证邮件 */
export async function sendLoginMail(email, link) {
  const ttl = config.auth.tokenTtlMin;
  const html = `
  <div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;background:#f4f9f6;padding:24px">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#37a678;padding:18px 24px;color:#fff;font-size:16px;font-weight:700">
        AI Hot Monitor · 登录
      </td></tr>
      <tr><td style="padding:24px">
        <p style="font-size:14px;color:#334155;margin:0 0 16px">点击下方按钮即可登录（${ttl} 分钟内有效，仅可使用一次）：</p>
        <p style="margin:0 0 20px">
          <a href="${link}" target="_blank"
             style="display:inline-block;background:#37a678;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700">
            立即登录
          </a>
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">按钮无法点击时，复制以下链接到浏览器打开：</p>
        <p style="font-size:12px;color:#37a678;word-break:break-all;margin:0 0 20px">${link}</p>
        <p style="font-size:12px;color:#94a3b8;margin:0">如果这不是你本人的操作，请忽略本邮件。</p>
      </td></tr>
    </table>
  </div>`;

  const text = `登录 AI Hot Monitor\n\n点击链接登录（${ttl} 分钟内有效，仅一次）：\n${link}\n\n若非本人操作请忽略。`;

  return sendMail({ to: email, subject: '[AI热点监控] 登录链接', html, text });
}
