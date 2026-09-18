import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 依次尝试加载 .env：先加载 server 目录下的（无论从哪里运行都能读到）
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const bool = (v, d = true) => {
  if (v === undefined || v === '') return d;
  return String(v).toLowerCase() === 'true' || v === '1';
};

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    // 内容筛选/验证模型（高频调用，需便宜快）
    model: process.env.OPENROUTER_MODEL || 'deepseek-v4-flash',
    // 评估法官模型（仅离线评估时调用，可用更强模型；留空则回退到 model）
    judgeModel: process.env.OPENROUTER_JUDGE_MODEL || '',
    // 相关性判定阈值：AI 只输出 relevance 分数，服务端用该阈值判定「是否相关」
    relevanceThreshold: Math.min(1, Math.max(0, num(process.env.RELEVANCE_THRESHOLD, 0.6))),
    // AI 校验前的廉价预过滤：丢弃标题/摘要完全不含关键词任一有效 token 的条目
    preFilterKeyword: bool(process.env.PRE_FILTER_KEYWORD, true),
    baseUrl: 'https://openrouter.ai/api/v1',
  },

  sources: {
    twitterApiKey: process.env.TWITTER_API_KEY || '',
    // Twitter 质量门槛（默认按需求确认值）
    twitterMinLikes: parseInt(process.env.TWITTER_MIN_LIKES || '30', 10),
    twitterMinRetweets: parseInt(process.env.TWITTER_MIN_RETWEETS || '10', 10),
    twitterMinViews: parseInt(process.env.TWITTER_MIN_VIEWS || '1000', 10),
    twitterMinFollowers: parseInt(process.env.TWITTER_MIN_FOLLOWERS || '100', 10),
    twitterVerifiedBonus: parseInt(process.env.TWITTER_VERIFIED_BONUS || '10', 10),
    // 微博搜索 cookie（不填则跳过微博搜索）
    weiboCookie: process.env.WEIBO_COOKIE || '',
    // 知乎 cookie（知乎反爬严格，不填则跳过知乎搜索）
    zhihuCookie: process.env.ZHIHU_COOKIE || '',
    // GitHub token（可选，不填则以匿名调用，限流 10 次/分钟）
    githubToken: process.env.GITHUB_TOKEN || '',
    // 第一层 · 时间窗口（小时）：仅过滤带发布时间的条目，无发布时间的放行（默认 7 天）
    timeWindowHours: parseInt(process.env.TIME_WINDOW_HOURS || '168', 10),
    // 按源差异化时间窗口（快节奏源短、慢热源长）；未列出的源使用 timeWindowHours
    timeWindowBySource: {
      Twitter: parseInt(process.env.TIME_WINDOW_TWITTER || '72', 10),
      HackerNews: parseInt(process.env.TIME_WINDOW_HACKERNEWS || '720', 10),
      GitHub: parseInt(process.env.TIME_WINDOW_GITHUB || '720', 10),
      Reddit: parseInt(process.env.TIME_WINDOW_REDDIT || '720', 10),
      V2EX: parseInt(process.env.TIME_WINDOW_V2EX || '720', 10),
    },
    // 采集条数（每源）：在质量层之前放宽采集，避免"先截断后过滤"
    collectLimit: parseInt(process.env.COLLECT_LIMIT || '20', 10),
    // 保留条数（每源）：质量层输出上限，避免单一源淹没
    perSourceLimit: parseInt(process.env.PER_SOURCE_LIMIT || '8', 10),
    // 查询扩展（Query Expansion）：为关键词生成同义/变体查询词以提高搜索召回
    queryExpand: bool(process.env.QUERY_EXPAND, true),
    // 扩展词数量上限
    queryExpandLimit: Math.min(5, Math.max(1, num(process.env.QUERY_EXPAND_LIMIT, 3))),
    enabled: {
      twitter: bool(process.env.SOURCE_TWITTER, true),
      hackernews: bool(process.env.SOURCE_HACKERNEWS, true),
      bilibili: bool(process.env.SOURCE_BILIBILI, true),
      weibo: bool(process.env.SOURCE_WEIBO, true),
      bing: bool(process.env.SOURCE_BING, true),
      sogou: bool(process.env.SOURCE_SOGOU, true),
      baidu: bool(process.env.SOURCE_BAIDU, true),
      github: bool(process.env.SOURCE_GITHUB, true),
      zhihu: bool(process.env.SOURCE_ZHIHU, true),
      // 境外源默认关闭（国内网络不可直连，可按需开启）
      google: bool(process.env.SOURCE_GOOGLE, false),
      duckduckgo: bool(process.env.SOURCE_DUCKDUCKGO, false),
      reddit: bool(process.env.SOURCE_REDDIT, false),
      v2ex: bool(process.env.SOURCE_V2EX, false),
    },
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
  },
};

export const hasAI = () => Boolean(config.openrouter.apiKey);
export const hasSMTP = () =>
  Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.to.length);
