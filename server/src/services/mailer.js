import nodemailer from 'nodemailer';
import { config, hasSMTP } from '../config.js';

/** 单例 transporter（连接池 + 串行发送，规避 SMTP 限流） */
let transporter = null;
if (hasSMTP()) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

export const getTransporter = () => transporter;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 统一发送入口：带重试（最多 3 次，指数退避）
 * @param {{to:string|string[], subject:string, html:string, text?:string, headers?:object}} mail
 * @returns {Promise<{ok:boolean, messageId?:string, error?:string}>}
 */
export async function sendMail({ to, subject, html, text, headers }) {
  if (!transporter) return { ok: false, error: 'SMTP 未配置' };
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: '无收件人' };

  const payload = {
    from: `"${config.smtp.fromName}" <${config.smtp.from}>`,
    to: recipients.join(','),
    subject,
    html,
    text,
  };
  // List-Unsubscribe 提升送达率；同时声明 RFC 8058 一键退订
  // （退订地址已带签名 token，收件端对该 URL 直接 POST 即可生效，见 routes/email.js）
  if (headers?.unsubscribe) {
    payload.headers = {
      'List-Unsubscribe': `<${headers.unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const info = await transporter.sendMail(payload);
      return { ok: true, messageId: info.messageId };
    } catch (err) {
      lastErr = err;
      console.warn(`[mailer] 发送失败（第 ${attempt}/3 次，${recipients.join(',')}）:`, err.message);
      if (attempt < 3) await sleep(attempt * 2000);
    }
  }
  return { ok: false, error: lastErr?.message || '发送失败' };
}

/** 启动自检：验证 SMTP 连通性（失败仅告警，不阻塞启动） */
export async function verifyMailer() {
  if (!transporter) return false;
  try {
    await transporter.verify();
    console.log('[mailer] SMTP 连接验证通过');
    return true;
  } catch (err) {
    console.warn('[mailer] SMTP 连接验证失败:', err.message);
    return false;
  }
}
