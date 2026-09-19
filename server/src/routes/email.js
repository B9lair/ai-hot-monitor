import { Router } from 'express';
import { prisma } from '../db.js';
import { verifyUnsubscribe } from '../services/auth.js';

const router = Router();

const page = (title, desc) => `
  <div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;
              min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f9f6">
    <div style="background:#fff;border-radius:14px;padding:32px 36px;text-align:center;max-width:420px">
      <h2 style="color:#37a678;margin:0 0 10px;font-size:18px">${title}</h2>
      <p style="color:#64748b;font-size:13px;margin:0">${desc}</p>
    </div>
  </div>`;

async function handleUnsubscribe(req, res) {
  const userId = verifyUnsubscribe(req.query.token);
  if (!userId) return res.status(400).send(page('链接无效', '退订链接不存在或已失效。'));
  try {
    await prisma.user.update({ where: { id: userId }, data: { notifyEmail: false } });
    res.send(page('已关闭邮件通知', '你仍可登录站点查看热点，随时可在设置中重新开启。'));
  } catch {
    res.status(400).send(page('操作失败', '用户不存在或已注销。'));
  }
}

router.get('/unsubscribe', handleUnsubscribe);
// List-Unsubscribe-Post 一键退订
router.post('/unsubscribe', handleUnsubscribe);

export default router;
