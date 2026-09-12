import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 依次尝试加载 .env：先加载 server 目录下的（无论从哪里运行都能读到）
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
    baseUrl: 'https://openrouter.ai/api/v1',
  },

  sources: {
    twitterApiKey: process.env.TWITTER_API_KEY || '',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    to: (process.env.NOTIFY_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  intervals: {
    monitorMin: parseInt(process.env.MONITOR_INTERVAL_MIN || '5', 10),
    discoverMin: parseInt(process.env.DISCOVER_INTERVAL_MIN || '15', 10),
  },
};

export const hasAI = () => Boolean(config.openrouter.apiKey);
export const hasSMTP = () =>
  Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.to.length);
