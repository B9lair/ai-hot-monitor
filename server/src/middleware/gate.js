import { Router } from 'express';
import { config } from '../config.js';

// 门禁放行白名单：这些「从邮件点进来」的回调入口不要求口令，
// 否则用户点邮件里的验证/退订链接会被门禁打断。
const PUBLIC_PATHS = new Set([
  '/api/auth/verify', // 邮箱登录回调（邮件里的链接）
  '/api/email/unsubscribe', // 一键退订回调（邮件里的链接，GET/POST）
]);

/**
 * 全站访问口令中间件。
 * ACCESS_PASSWORD 非空时，校验会话 gateOk，未通过返回 401 + needGate。
 * 注意：/api/health 与 /api/gate/* 在 index.js 中挂载于本中间件之前，天然公开。
 */
export function gateMiddleware(req, res, next) {
  if (!config.gate.password) return next(); // 未启用门禁
  if (PUBLIC_PATHS.has(req.path)) return next(); // 邮件回调公开
  if (req.session?.gateOk) return next(); // 已通过口令
  return res.status(401).json({ error: '需要访问口令', needGate: true });
}

export const gateRouter = Router();

/** 查询门禁状态（公开，前端启动时调用） */
gateRouter.get('/status', (req, res) => {
  res.json({
    required: Boolean(config.gate.password),
    authed: !config.gate.password || Boolean(req.session?.gateOk),
  });
});

/** 校验口令（公开）；通过后写入会话 gateOk */
gateRouter.post('/verify', (req, res) => {
  if (!config.gate.password) return res.json({ ok: true });
  if (req.body?.password === config.gate.password) {
    req.session.gateOk = true;
    req.session.save(() => res.json({ ok: true }));
  } else {
    res.status(401).json({ error: '口令错误', needGate: true });
  }
});
