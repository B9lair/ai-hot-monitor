import { Router } from 'express';
import { prisma } from '../db.js';
import { requestLogin, consumeLoginToken } from '../services/auth.js';
import { baseUrl } from '../urls.js';

const router = Router();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';

/** 申请登录链接（对外始终成功，防邮箱枚举） */
router.post('/login', async (req, res) => {
  try {
    // 链接基地址按本次访问来源推断（本地 / 局域网 IP / 域名都自适应）
    const result = await requestLogin(req.body?.email, clientIp(req), baseUrl(req));
    if (!result.sent && result.reason) console.log(`[auth] 未发送登录邮件: ${result.reason}`);
  } catch (err) {
    console.error('[auth] 登录申请失败:', err.message);
  }
  res.json({ ok: true });
});

/** 校验链接 → 建立会话 → 回跳前端 */
router.get('/verify', async (req, res) => {
  const back = (q) => res.redirect(`${baseUrl(req)}/?login=${q}`);
  try {
    const user = await consumeLoginToken(req.query.token);
    if (!user) return back('expired');
    req.session.regenerate((err) => {
      if (err) return back('error');
      req.session.userId = user.id;
      req.session.save(() => back('ok'));
    });
  } catch (err) {
    console.error('[auth] 校验失败:', err.message);
    back('error');
  }
});

/** 当前登录用户 */
router.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, notifyEmail: true },
  });
  res.json({ user: user || null });
});

/** 退出登录 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ahm.sid');
    res.json({ ok: true });
  });
});

/** 通知偏好（邮件开关） */
router.patch('/prefs', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: '未登录' });
  const data = {};
  if (typeof req.body?.notifyEmail === 'boolean') data.notifyEmail = req.body.notifyEmail;
  const user = await prisma.user.update({
    where: { id: req.session.userId },
    data,
    select: { id: true, email: true, notifyEmail: true },
  });
  res.json(user);
});

export default router;
