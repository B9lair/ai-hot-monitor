import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 精简配置：只保留「数据源 + OpenRouter AI」相关项。
 * 取值优先级：环境变量 > config.json > 内置默认值。
 * config.json 路径可用 AHM_CONFIG 环境变量覆盖，默认读取 skill 根目录的 config.json。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const bool = (v, d = true) => {
  if (v === undefined || v === '') return d;
  return String(v).toLowerCase() === 'true' || v === '1';
};

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** 读取可选 config.json（缺失/损坏回退空对象） */
function loadConfigFile() {
  const file = process.env.AHM_CONFIG
    ? path.resolve(process.env.AHM_CONFIG)
    : path.resolve(__dirname, '../config.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const file = loadConfigFile();
const env = process.env;
const fileEnabled = file.enabledSources || {};

/** 环境变量 > config.json > 默认值 */
const pick = (envKey, fileKey, dflt) => {
  if (env[envKey] !== undefined && env[envKey] !== '') return env[envKey];
  if (file[fileKey] !== undefined) return file[fileKey];
  return dflt;
};

/** 数据源开关：环境变量 SOURCE_* > config.json enabledSources.* > 默认 true */
const sourceEnabled = (envKey, key) =>
  bool(env[envKey] !== undefined && env[envKey] !== '' ? env[envKey] : fileEnabled[key], true);

export const config = {
  openrouter: {
    apiKey: pick('OPENROUTER_API_KEY', 'openrouterApiKey', ''),
    model: pick('OPENROUTER_MODEL', 'openrouterModel', 'deepseek-v4-flash'),
    relevanceThreshold: Math.min(1, Math.max(0, num(pick('RELEVANCE_THRESHOLD', 'relevanceThreshold', 0.6), 0.6))),
    preFilterKeyword: bool(pick('PRE_FILTER_KEYWORD', 'preFilterKeyword', true), true),
    baseUrl: 'https://openrouter.ai/api/v1',
    maxRetries: Math.max(0, Math.min(5, parseInt(pick('AI_MAX_RETRIES', 'aiMaxRetries', '2'), 10) || 0)),
    retryBaseMs: Math.max(100, parseInt(pick('AI_RETRY_BASE_MS', 'aiRetryBaseMs', '800'), 10) || 800),
  },

  sources: {
    twitterApiKey: pick('TWITTER_API_KEY', 'twitterApiKey', ''),
    twitterMinLikes: parseInt(pick('TWITTER_MIN_LIKES', 'twitterMinLikes', '30'), 10),
    twitterMinRetweets: parseInt(pick('TWITTER_MIN_RETWEETS', 'twitterMinRetweets', '10'), 10),
    twitterMinViews: parseInt(pick('TWITTER_MIN_VIEWS', 'twitterMinViews', '1000'), 10),
    twitterMinFollowers: parseInt(pick('TWITTER_MIN_FOLLOWERS', 'twitterMinFollowers', '100'), 10),
    twitterVerifiedBonus: parseInt(pick('TWITTER_VERIFIED_BONUS', 'twitterVerifiedBonus', '10'), 10),
    weiboCookie: pick('WEIBO_COOKIE', 'weiboCookie', ''),
    zhihuCookie: pick('ZHIHU_COOKIE', 'zhihuCookie', ''),
    githubToken: pick('GITHUB_TOKEN', 'githubToken', ''),
    enrichBilibili: bool(pick('ENRICH_BILIBILI', 'enrichBilibili', true), true),
    enrichLimit: Math.min(20, Math.max(0, num(pick('ENRICH_LIMIT', 'enrichLimit', 5), 5))),
    biliSessdata: pick('BILI_SESSDATA', 'biliSessdata', ''),
    timeWindowHours: parseInt(pick('TIME_WINDOW_HOURS', 'timeWindowHours', '168'), 10),
    timeWindowBySource: {
      Twitter: parseInt(pick('TIME_WINDOW_TWITTER', 'timeWindowTwitter', '72'), 10),
      HackerNews: parseInt(pick('TIME_WINDOW_HACKERNEWS', 'timeWindowHackernews', '720'), 10),
      GitHub: parseInt(pick('TIME_WINDOW_GITHUB', 'timeWindowGithub', '720'), 10),
      微博: parseInt(pick('TIME_WINDOW_WEIBO', 'timeWindowWeibo', '72'), 10),
      B站: parseInt(pick('TIME_WINDOW_BILIBILI', 'timeWindowBilibili', '720'), 10),
      知乎: parseInt(pick('TIME_WINDOW_ZHIHU', 'timeWindowZhihu', '720'), 10),
    },
    collectLimit: parseInt(pick('COLLECT_LIMIT', 'collectLimit', '20'), 10),
    perSourceLimit: parseInt(pick('PER_SOURCE_LIMIT', 'perSourceLimit', '8'), 10),
    minHotScore: Math.min(100, Math.max(0, num(pick('MIN_HOT_SCORE', 'minHotScore', 0), 0))),
    queryExpand: bool(pick('QUERY_EXPAND', 'queryExpand', true), true),
    queryExpandLimit: Math.min(5, Math.max(1, num(pick('QUERY_EXPAND_LIMIT', 'queryExpandLimit', 3), 3))),
    enabled: {
      twitter: sourceEnabled('SOURCE_TWITTER', 'twitter'),
      hackernews: sourceEnabled('SOURCE_HACKERNEWS', 'hackernews'),
      github: sourceEnabled('SOURCE_GITHUB', 'github'),
      bilibili: sourceEnabled('SOURCE_BILIBILI', 'bilibili'),
      weibo: sourceEnabled('SOURCE_WEIBO', 'weibo'),
      zhihu: sourceEnabled('SOURCE_ZHIHU', 'zhihu'),
      bing: sourceEnabled('SOURCE_BING', 'bing'),
      baidu: sourceEnabled('SOURCE_BAIDU', 'baidu'),
      sogou: sourceEnabled('SOURCE_SOGOU', 'sogou'),
    },
  },
};

export const hasAI = () => Boolean(config.openrouter.apiKey);
