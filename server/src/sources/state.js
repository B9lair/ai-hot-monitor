import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

/**
 * 数据源运行时开关（可经前端「数据源」面板动态切换，无需重启）。
 *
 * 设计要点：
 * - 初始值取自 .env 的 SOURCE_* 开关（config.sources.enabled）。
 * - 前端切换后写入本地 JSON 文件（server/.source-state.json），重启后依然生效。
 * - 优先级：持久化文件 > .env 默认值。二者都不存在时用 config 默认。
 * - 这里的 enabled 仅表示「用户是否启用该源」；是否真的能产出结果还取决于
 *   key/cookie 是否配置（见 available）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 持久化文件位置：默认 server/.source-state.json，可用 SOURCE_STATE_FILE 覆盖（测试用）
const STATE_FILE = process.env.SOURCE_STATE_FILE
  ? path.resolve(process.env.SOURCE_STATE_FILE)
  : path.resolve(__dirname, '../../.source-state.json');

/** 可运行时切换的数据源 key（与 config.sources.enabled 一一对应） */
const SOURCE_KEYS = [
  'twitter',
  'hackernews',
  'bilibili',
  'weibo',
  'bing',
  'sogou',
  'baidu',
  'github',
  'zhihu',
  'google',
  'duckduckgo',
  'reddit',
  'v2ex',
];

/**
 * 数据源元信息（静态描述，供 /api/sources 与前端面板展示）。
 * - region: domestic（国内可用）/ foreign（境外，默认关闭，需代理）
 * - needs: 产出结果所需的额外凭证类型 key（API Key）/ cookie（登录 Cookie）/ null
 * - note: 可用状态下的附加提示（无则空串）
 */
export const SOURCE_META = [
  { key: 'twitter', label: 'Twitter', region: 'domestic', needs: 'key', note: '' },
  { key: 'hackernews', label: 'HackerNews', region: 'domestic', needs: null, note: '' },
  { key: 'bilibili', label: 'B站', region: 'domestic', needs: null, note: '' },
  { key: 'weibo', label: '微博', region: 'domestic', needs: 'cookie', note: '' },
  { key: 'bing', label: 'Bing', region: 'domestic', needs: null, note: '' },
  { key: 'sogou', label: '搜狗', region: 'domestic', needs: null, note: '' },
  { key: 'baidu', label: '百度', region: 'domestic', needs: null, note: '' },
  { key: 'github', label: 'GitHub', region: 'domestic', needs: null, note: 'Token 可选' },
  { key: 'zhihu', label: '知乎', region: 'domestic', needs: 'cookie', note: '' },
  { key: 'google', label: 'Google', region: 'foreign', needs: null, note: '需代理' },
  { key: 'duckduckgo', label: 'DuckDuckGo', region: 'foreign', needs: null, note: '需代理' },
  { key: 'reddit', label: 'Reddit', region: 'foreign', needs: null, note: '需代理' },
  { key: 'v2ex', label: 'V2EX', region: 'foreign', needs: null, note: '需代理' },
];

/** 运行时 enabled 状态：从 config 默认值起步，再叠加持久化文件覆盖 */
const enabled = { ...config.sources.enabled };

/** 读取持久化文件，覆盖默认值（文件缺失/损坏时静默回退默认） */
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const k of SOURCE_KEYS) {
      if (typeof saved[k] === 'boolean') enabled[k] = saved[k];
    }
  } catch {
    /* 首次运行无文件，或文件损坏，均回退 .env 默认 */
  }
}
load();

/** 把当前 enabled 状态写入持久化文件（失败不阻断，仅告警） */
function persist() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(enabled, null, 2));
  } catch (err) {
    console.warn('[sources] 持久化数据源开关失败:', err.message);
  }
}

/** 返回当前数据源开关快照（副本，避免外部误改内部状态） */
export function getSourceEnabled() {
  return { ...enabled };
}

/** 设置某个数据源的运行时开关（未知 key 抛错；value 强转布尔） */
export function setSourceEnabled(key, value) {
  if (!SOURCE_KEYS.includes(key)) {
    throw new Error(`未知数据源: ${key}`);
  }
  enabled[key] = Boolean(value);
  persist();
  return { ...enabled };
}

/** 判断某源是否具备产出结果所需的凭证（无凭证则即使开启也不会返回内容） */
function isAvailable(meta) {
  if (meta.key === 'twitter') return Boolean(config.sources.twitterApiKey);
  if (meta.key === 'weibo') return Boolean(config.sources.weiboCookie);
  if (meta.key === 'zhihu') return Boolean(config.sources.zhihuCookie);
  return true;
}

/** 组装完整数据源列表（静态元信息 + 运行时 enabled + 可用性） */
export function getSourceList() {
  return SOURCE_META.map((m) => ({
    key: m.key,
    label: m.label,
    region: m.region,
    needs: m.needs,
    note: m.note,
    enabled: Boolean(enabled[m.key]),
    available: isAvailable(m),
  }));
}
