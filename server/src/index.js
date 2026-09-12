import express from 'express';
import http from 'http';
import cors from 'cors';
import { config, hasAI } from './config.js';
import { initSocket } from './socket.js';
import { initScheduler } from './scheduler.js';
import apiRouter from './routes/api.js';

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, hasAI: hasAI() }));
app.use('/api', apiRouter);

const server = http.createServer(app);
initSocket(server);
initScheduler();

server.listen(config.port, () => {
  console.log(`✅ AI Hot Monitor 后端已启动: http://localhost:${config.port}`);
  if (!hasAI()) {
    console.warn('⚠️  未配置 OPENROUTER_API_KEY，AI 识别将退化为关键词匹配。请在 .env 中填写。');
  }
});
