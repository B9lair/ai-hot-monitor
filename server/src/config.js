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

/** 解析免打扰时段（如 "23-8" → { start: 23, end: 8 }）；留空返回 null */
const parseQuietHours = (v) => {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;
  return { start, end };
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
    // AI 请求失败重试次数（覆盖网络抖动 / 429 / 5xx / 空响应；0 = 不重试）
    maxRetries: Math.max(0, Math.min(5, parseInt(process.env.AI_MAX_RETRIES || '2', 10) || 0)),
    // 重试基础退避（毫秒），实际延迟按 2^attempt 指数增长并叠加抖动
    retryBaseMs: Math.max(100, parseInt(process.env.AI_RETRY_BASE_MS || '800', 10) || 800),
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
    // B站详情富化：补充播放/赞/投币/收藏/弹幕/评论/分享与发布时间（关闭则退回仅播放量）
    enrichBilibili: bool(process.env.ENRICH_BILIBILI, true),
    // 每源详情富化条数上限（避免额外请求爆炸）
    enrichLimit: Math.min(20, Math.max(0, num(process.env.ENRICH_LIMIT, 5))),
    // B站 cookie（可选，提升详情接口稳定性）
    biliSessdata: process.env.BILI_SESSDATA || '',
    // 第一层 · 时间窗口（小时）：仅过滤带发布时间的条目，无发布时间的放行（默认 7 天）
    timeWindowHours: parseInt(process.env.TIME_WINDOW_HOURS || '168', 10),
    // 按源差异化时间窗口（快节奏源短、慢热源长）；未列出的源使用 timeWindowHours
    timeWindowBySource: {
      Twitter: parseInt(process.env.TIME_WINDOW_TWITTER || '72', 10),
      HackerNews: parseInt(process.env.TIME_WINDOW_HACKERNEWS || '720', 10),
      GitHub: parseInt(process.env.TIME_WINDOW_GITHUB || '720', 10),
      Reddit: parseInt(process.env.TIME_WINDOW_REDDIT || '720', 10),
      V2EX: parseInt(process.env.TIME_WINDOW_V2EX || '720', 10),
      微博: parseInt(process.env.TIME_WINDOW_WEIBO || '72', 10),
      B站: parseInt(process.env.TIME_WINDOW_BILIBILI || '720', 10),
      知乎: parseInt(process.env.TIME_WINDOW_ZHIHU || '720', 10),
    },
    // 采集条数（每源）：在质量层之前放宽采集，避免"先截断后过滤"
    collectLimit: parseInt(process.env.COLLECT_LIMIT || '20', 10),
    // 保留条数（每源）：质量层输出上限，避免单一源淹没
    perSourceLimit: parseInt(process.env.PER_SOURCE_LIMIT || '8', 10),
    // 第二层全局热度门槛（0~100，默认 0 = 关闭）：过滤「有 hotScore 且低于门槛」的条目（搜索引擎无 hotScore 不受影响）
    minHotScore: Math.min(100, Math.max(0, num(process.env.MIN_HOT_SCORE, 0))),
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
    fromName: process.env.MAIL_FROM_NAME || 'AI热点监控',
  },

  // 登录与鉴权（邮箱免密 Magic Link）
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    // 验证链接基地址；留空则自动按访问来源推断（见 src/urls.js）
    appBaseUrl: (process.env.APP_BASE_URL || '').trim(),
    tokenTtlMin: Math.max(1, parseInt(process.env.LOGIN_TOKEN_TTL_MIN || '10', 10)),
    resendCooldownSec: Math.max(0, parseInt(process.env.LOGIN_RESEND_COOLDOWN_SEC || '60', 10)),
    maxLoginPerIpHour: Math.max(1, parseInt(process.env.LOGIN_MAX_PER_IP_HOUR || '10', 10)),
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
    cookieMaxAgeDays: Math.max(1, parseInt(process.env.SESSION_MAX_AGE_DAYS || '30', 10)),
  },

  // 访问口令（全站门禁）：留空 = 关闭，任何人均可访问
  gate: {
    password: process.env.ACCESS_PASSWORD || '',
  },

  // 邮件通知策略：按用户自定义间隔汇总发送（与监控轮次解耦）
  email: {
    // 用户未设置时的默认发送间隔（分钟）
    defaultIntervalMin: Math.max(1, parseInt(process.env.EMAIL_DEFAULT_INTERVAL_MIN || '60', 10)),
    // 用户可设置的间隔钳制范围（分钟）
    minIntervalMin: Math.max(1, parseInt(process.env.EMAIL_MIN_INTERVAL_MIN || '15', 10)),
    maxIntervalMin: Math.max(1, parseInt(process.env.EMAIL_MAX_INTERVAL_MIN || '43200', 10)),
    // 汇总调度器扫描间隔（分钟）：每 tick 扫描一次，判断哪些用户已到各自间隔
    dispatcherTickMin: Math.max(1, parseInt(process.env.EMAIL_DISPATCH_TICK_MIN || '1', 10)),
    // 单封邮件最多条数（超出分批）
    maxItems: Math.max(1, parseInt(process.env.EMAIL_MAX_ITEMS || '20', 10)),
    quietHours: parseQuietHours(process.env.EMAIL_QUIET_HOURS),
    minRelevance: Math.min(1, Math.max(0, num(process.env.EMAIL_MIN_RELEVANCE, 0))),
    minHotScore: Math.min(100, Math.max(0, num(process.env.EMAIL_MIN_HOT_SCORE, 0))),
  },

  // 前端地址；留空 = 不限制跨域来源，并按访问来源自动推断（见 src/urls.js）
  clientOrigin: (process.env.CLIENT_ORIGIN || '').trim(),

  // 网络代理（可选）：axios 会自动读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 环境变量，
  // 这里仅读取用于启动提示，不改变 axios 行为。国内网络测试境外源时填 Clash 端口即可。
  proxy: {
    url: (
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      ''
    ).trim(),
  },

  intervals: {
    // 调度 tick 间隔（分钟）：调度器每 tick 检查一次哪些关键词到期（默认 1 分钟）
    tickMin: Math.max(1, parseInt(process.env.SCHEDULER_TICK_MIN || '1', 10)),
    // 关键词默认抓取间隔（分钟）：新增/未指定间隔时使用（默认 60 = 1 小时）
    defaultIntervalMin: Math.max(1, parseInt(process.env.MONITOR_INTERVAL_MIN || '60', 10)),
  },

  // 信息生命周期：命中保留 N 天（超过且未收藏 → 前端隐藏，数据库保留）
  alertTtlDays: Math.max(1, parseInt(process.env.ALERT_TTL_DAYS || '7', 10)),
};

export const hasAI = () => Boolean(config.openrouter.apiKey);

/** SMTP 缺少哪些必填项（用于启动提示） */
export const smtpMissingVars = () => {
  const missing = [];
  if (!config.smtp.host) missing.push('SMTP_HOST');
  if (!config.smtp.user) missing.push('SMTP_USER');
  if (!config.smtp.pass) missing.push('SMTP_PASS');
  return missing;
};

export const hasSMTP = () => smtpMissingVars().length === 0;

/** 钳制邮件发送间隔（分钟）到 [minIntervalMin, maxIntervalMin]；非法值回退默认 */
export const clampEmailIntervalMin = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return config.email.defaultIntervalMin;
  return Math.min(config.email.maxIntervalMin, Math.max(config.email.minIntervalMin, n));
};
