import nodemailer from 'nodemailer';
import { config, hasSMTP } from '../config.js';
import { prisma } from '../db.js';
import { broadcastNotification } from '../socket.js';

let mailer = null;
if (hasSMTP()) {
  mailer = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

/**
 * 发送通知：同时写库（浏览器通知）+ 邮件（如已配置）
 * @param {object} n { type, title, content, url }
 */
export async function sendNotification(n) {
  // 1. 记录到数据库（浏览器端通过 Socket.io 实时推送）
  const record = await prisma.notification.create({
    data: {
      type: n.type || 'alert',
      channel: 'browser',
      title: n.title,
      content: n.content,
      url: n.url || null,
      status: 'sent',
    },
  });

  // 实时推送到浏览器客户端
  broadcastNotification({
    id: record.id,
    type: record.type,
    title: record.title,
    content: record.content,
    url: record.url,
    createdAt: record.createdAt,
  });

  // 2. 邮件通知
  if (hasSMTP() && mailer) {
    try {
      await mailer.sendMail({
        from: config.smtp.from,
        to: config.smtp.to.join(','),
        subject: `[AI热点监控] ${n.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto">
            <h2 style="color:#0ea5e9">${escapeHtml(n.title)}</h2>
            <p style="color:#475569">${escapeHtml(n.content)}</p>
            ${n.url ? `<p><a href="${n.url}" style="color:#0ea5e9">查看原文 →</a></p>` : ''}
            <hr style="border:none;border-top:1px solid #e2e8f0">
            <p style="color:#94a3b8;font-size:12px">由 AI Hot Monitor 自动发送</p>
          </div>
        `,
      });
      await prisma.notification.create({
        data: {
          type: n.type || 'alert',
          channel: 'email',
          title: n.title,
          content: n.content,
          url: n.url || null,
          status: 'sent',
        },
      });
    } catch (err) {
      console.warn('[notifier] 邮件发送失败:', err.message);
    }
  }

  return record;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
