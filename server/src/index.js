import express from 'express';
import http from 'http';
import cors from 'cors';
import { config, hasAI, hasSMTP, smtpMissingVars } from './config.js';
import { sessionMiddleware } from './session.js';
import { initSocket } from './socket.js';
import { initScheduler } from './scheduler.js';
import { verifyMailer } from './services/mailer.js';
import { rememberOrigin } from './urls.js';
import { gateMiddleware, gateRouter } from './middleware/gate.js';
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

// 公开：健康检查 / 门禁状态与校验
app.get('/api/health', (_req, res) => res.json({ ok: true, hasAI: hasAI() }));
app.use('/api/gate', gateRouter);

// 全站访问口令（ACCESS_PASSWORD 非空时生效；verify / unsubscribe 邮件回调放行）
app.use(gateMiddleware);

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
  // 境外源经代理访问：提示代理是否生效，避免「开了境外源但忘了挂代理」白等超时
  const foreign = ['google', 'duckduckgo', 'reddit', 'v2ex'].filter(
    (k) => config.sources.enabled[k],
  );
  if (config.proxy.url) {
    console.log(`🌐 网络代理已启用: ${config.proxy.url}（境外源经代理访问）`);
  } else if (foreign.length) {
    console.warn(
      `⚠️  已开启境外源（${foreign.join(' / ')}）但未检测到 HTTPS_PROXY/HTTP_PROXY，国内网络下预计全部超时。`,
    );
  }
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
