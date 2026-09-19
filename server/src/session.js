import session from 'express-session';
import { config } from './config.js';
import { PrismaSessionStore } from './prisma-session-store.js';

/**
 * 会话中间件：HttpOnly Cookie + SQLite 持久化（重启不掉线）
 * 仅挂到 Express（见 index.js）；Socket.io 不共享会话，允许匿名连接并全局广播（见 socket.js）。
 */
export const sessionMiddleware = session({
  name: 'ahm.sid',
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(),
  cookie: {
    httpOnly: true,
    sameSite: 'lax', // 允许从邮件点击链接（顶层导航）携带 Cookie
    secure: config.auth.cookieSecure, // 生产 HTTPS 置 true
    maxAge: config.auth.cookieMaxAgeDays * 86400 * 1000,
  },
});
