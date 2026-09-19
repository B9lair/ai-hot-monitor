import { prisma } from '../db.js';
import { broadcastNotification } from '../socket.js';

/**
 * 实时浏览器通知：写一条全局记录 + 广播给所有客户端（登录与否都能实时刷新）。
 * 邮件通知是独立通道（见 services/email.js），只有登录用户才会收到。
 * @param {object} n { type, title, content, url }
 */
export async function notifyBrowser(n) {
  const record = await prisma.notification.create({
    data: {
      type: n.type || 'alert',
      channel: 'browser',
      title: n.title,
      content: n.content,
      url: n.url || null,
      status: 'sent',
      userId: null,
    },
  });

  broadcastNotification(record);
  return record;
}
