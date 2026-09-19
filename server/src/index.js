import express from 'express';
import http from 'http';
import cors from 'cors';
import { config, hasAI, hasSMTP, smtpMissingVars } from './config.js';
import { sessionMiddleware } from './session.js';
import { initSocket } from './socket.js';
import { initScheduler } from './scheduler.js';
import { verifyMailer } from './services/mailer.js';
import { rememberOrigin } from './urls.js';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import emailRouter from './routes/email.js';

const app = express();
// CLIENT_ORIGIN 留空时反射请求来源（本地 / 局域网 IP / 域名都自适应）
app.use(cors({ origin: config.clientOrigin || true, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);
// 记录访问来源，供后台任务（定时邮件）拼链接使用
app.use((req, _res, next) => {
  rememberOrigin(req);
  next();
});

// 公开：健康检查 / 登录 / 退订
app.get('/api/health', (_req, res) => res.json({ ok: true, hasAI: hasAI() }));
app.use('/api/auth', authRouter);
app.use('/api/email', emailRouter);

// 业务接口：免登录可用（登录仅用于接收邮件通知）
app.use('/api', apiRouter);

const server = http.createServer(app);

// 启动失败时明确报错并退出，避免 node --watch 静默卡在「Waiting for file changes」
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ 端口 ${config.port} 已被占用：请先结束占用该端口的进程，或修改 .env 中的 PORT。`);
  } else {
    console.error('❌ 服务启动失败:', err.message);
  }
  process.exit(1);
});

initSocket(server);
initScheduler();

server.listen(config.port, () => {
  console.log(`✅ AI Hot Monitor 后端已启动: http://localhost:${config.port}`);
  if (!hasAI()) {
    console.warn('⚠️  未配置 OPENROUTER_API_KEY，AI 识别将退化为关键词匹配。请在 .env 中填写。');
  }
  if (!hasSMTP()) {
    console.warn(
      `⚠️  SMTP 未配置（缺少 ${smtpMissingVars().join(' / ')}），邮箱登录与邮件通知不可用。请在 server/.env 中填写。`,
    );
  } else {
    verifyMailer();
  }
});
