/**
 * AI 服务层（JS 版，移植自 server/src/ai/openrouter.ts）
 *
 * 对「模型返回值不可信」做了两层防护：
 *   1. 语法层：parseJSON() 多级容错（代码块包裹 / 前后杂文 / 字符串内裸换行 / 尾逗号）
 *   2. 语义层：zod schema 校验 + 类型安全强转（coerce01 / coerceBool）
 */
import axios from 'axios';
import { z } from 'zod';
import { config, hasAI } from './config.js';
import { PROMPT_VERSION, relevancePrompt, authenticityPrompt } from './prompts.js';

export { PROMPT_VERSION };

// ===================== 调用统计与失败重试 =====================

export const aiStats = {
  calls: 0,
  retries: 0,
  failures: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalMs: 0,
};

export function resetAiStats() {
  aiStats.calls = 0;
  aiStats.retries = 0;
  aiStats.failures = 0;
  aiStats.promptTokens = 0;
  aiStats.completionTokens = 0;
  aiStats.totalMs = 0;
}

export function getAiStats() {
  return { ...aiStats };
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNREFUSED',
]);

export function isRetryableError(err) {
  const e = err;
  const status = e?.response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  if (e?.code && RETRYABLE_CODES.has(e.code)) return true;
  return String(e?.message || '').includes('返回为空');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 调用 OpenRouter chat completion（带指数退避重试）。
 */
export async function chat(messages, opts = {}) {
  if (!hasAI()) {
    throw new Error('OpenRouter API Key 未配置，请在 config.json 中填写 openrouterApiKey');
  }

  const maxRetries = config.openrouter.maxRetries;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await axios.post(
        `${config.openrouter.baseUrl}/chat/completions`,
        {
          model: opts.model || config.openrouter.model,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.max_tokens ?? 2048,
          response_format: opts.json ? { type: 'json_object' } : undefined,
          ...(opts.extra || {}),
        },
        {
          headers: {
            Authorization: `Bearer ${config.openrouter.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-hot-monitor.local',
            'X-Title': 'AI Hot Monitor',
          },
          timeout: 60000,
        },
      );

      aiStats.calls++;
      aiStats.totalMs += Date.now() - startedAt;
      const usage = res.data?.usage;
      if (usage) {
        aiStats.promptTokens += Number(usage.prompt_tokens) || 0;
        aiStats.completionTokens += Number(usage.completion_tokens) || 0;
      }

      const choice = res.data?.choices?.[0];
      const message = choice?.message;
      const content = message?.content?.trim();
      if (!content) {
        const reason =
          choice?.finish_reason === 'length'
            ? '输出被 max_tokens 截断（finish_reason=length），请增大 max_tokens'
            : `reason=${choice?.finish_reason}`;
        const reasoningInfo = message?.reasoning
          ? `，reasoning 已生成 ${message.reasoning.length} 字符`
          : '';
        throw new Error(`OpenRouter 返回为空: ${reason}${reasoningInfo}`);
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isRetryableError(err)) break;
      aiStats.retries++;
      const delay =
        Math.min(8000, config.openrouter.retryBaseMs * 2 ** attempt) +
        Math.floor(Math.random() * 250);
      console.warn(`[ai] 调用失败（第 ${attempt + 1} 次），${delay}ms 后重试: ${err.message}`);
      await sleep(delay);
    }
  }

  aiStats.failures++;
  throw lastErr;
}

/** 修复 LLM 生成的常见非法 JSON：字符串内裸换行/制表符、尾逗号 */
function repairJSON(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && ch === '\n') {
      out += '\\n';
      continue;
    }
    if (inStr && ch === '\r') continue;
    if (inStr && ch === '\t') {
      out += '\\t';
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** 解析 JSON 响应（容错） */
export function parseJSON(text) {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const candidates = [cleaned];
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);

  for (const c of candidates) {
    for (const v of [c, repairJSON(c)]) {
      try {
        return JSON.parse(v);
      } catch {
        /* 尝试下一种修复 */
      }
    }
  }
  throw new Error(`AI 返回无法解析为 JSON：${cleaned.slice(0, 200)}`);
}

/** 把数值夹在 0~1 之间 */
export function coerce01(v, fallback = 0, field = '') {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  if (field) console.warn(`[ai] 字段 ${field} 非法（${JSON.stringify(v)}），已回退默认值 ${fallback}`);
  return fallback;
}

/** 严格布尔解析 */
export function coerceBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '真'].includes(s)) return true;
    if (['false', '0', 'no', 'n', '否', '假', ''].includes(s)) return false;
  }
  return fallback;
}

/** 宽松文本：仅接受字符串，其余按原样降级 */
function coerceText(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// ===================== LLM 输出 schema（zod 语义校验） =====================

/** 相关性判定原始字段（全部可选） */
const rawRelevanceSchema = z
  .object({
    relevance: z.unknown(),
    keywordMentioned: z.unknown(),
    matchType: z.unknown(),
    summary: z.unknown(),
    relevanceReason: z.unknown(),
  })
  .partial();

export const relevanceResultSchema = rawRelevanceSchema.transform((o) => ({
  relevance: coerce01(o.relevance, 0, 'relevance'),
  keywordMentioned: coerceBool(o.keywordMentioned, false),
  matchType: coerceText(o.matchType),
  summary: coerceText(o.summary),
  relevanceReason: coerceText(o.relevanceReason),
}));

/** 真伪判定原始字段 */
const rawAuthenticitySchema = z
  .object({
    isFake: z.unknown(),
    confidence: z.unknown(),
    fakeReason: z.unknown(),
  })
  .partial();

export const authenticityResultSchema = rawAuthenticitySchema.transform((o) => ({
  isFake: coerceBool(o.isFake, false),
  confidence: coerce01(o.confidence, 0.5, 'confidence'),
  fakeReason: coerceText(o.fakeReason),
}));

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseRelevanceResult(raw) {
  if (!isPlainObject(raw)) {
    console.warn(
      `[ai] 相关性判定返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`,
    );
    return relevanceResultSchema.parse({});
  }
  return relevanceResultSchema.parse(raw);
}

export function parseAuthenticityResult(raw) {
  if (!isPlainObject(raw)) {
    console.warn(
      `[ai] 真伪判定返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`,
    );
    return authenticityResultSchema.parse({});
  }
  return authenticityResultSchema.parse(raw);
}

// ===================== 关键词与相关性工具 =====================

/** 拆分关键词为 token */
export function keywordTokens(keyword) {
  return String(keyword || '')
    .split(/[\s,，、;；:：/|｜+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 廉价预过滤：标题/摘要命中关键词「任一有效 token」即放行 */
export function mentionsKeyword(item, keyword, extras = []) {
  const tokens = keywordTokens(keyword);
  for (const e of extras || []) tokens.push(...keywordTokens(e));
  if (tokens.length === 0) return true;
  const haystack = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  const lowered = tokens.map((t) => t.toLowerCase());
  const valid = lowered.filter((t) => t.length >= 2 && !/^\d+(\.\d+)?$/.test(t));
  const pool = valid.length ? valid : lowered;
  return pool.some((t) => haystack.includes(t));
}

/** 相关性判定：AI 只输出 relevance 分数，用阈值判定是否「相关」 */
export function isRelevantHit(result, threshold = config.openrouter.relevanceThreshold) {
  const r = Number(result?.relevance);
  return Number.isFinite(r) && r >= threshold;
}

// ===================== AI 能力 =====================

/** 相关性判定（独立调用） */
export async function verifyRelevance(keyword, item) {
  const messages = [
    { role: 'system', content: '你是一个严谨的信息相关性审核助手，只输出 JSON。' },
    { role: 'user', content: relevancePrompt(keyword, item) },
  ];
  const attempts = 2;
  let lastErr = new Error('AI 相关性判定失败');
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = parseJSON(await chat(messages, { json: true, max_tokens: 1200 }));
      if (isPlainObject(raw) && raw.relevance !== undefined && raw.relevance !== null) {
        return parseRelevanceResult(raw);
      }
      lastErr = new Error('响应缺少 relevance 字段');
    } catch (err) {
      lastErr = err;
    }
    if (i + 1 < attempts) {
      console.warn(`[ai] 相关性判定无效（第 ${i + 1} 次），补试一次: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

/** 真伪判定（独立调用） */
export async function checkAuthenticity(keyword, item) {
  const messages = [
    { role: 'system', content: '你是一个严谨的信息真实性审核助手，只输出 JSON。' },
    { role: 'user', content: authenticityPrompt(keyword, item) },
  ];
  const attempts = 2;
  let lastErr = new Error('AI 真伪判定失败');
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = parseJSON(await chat(messages, { json: true, max_tokens: 600 }));
      if (isPlainObject(raw) && raw.isFake !== undefined && raw.isFake !== null) {
        return parseAuthenticityResult(raw);
      }
      lastErr = new Error('响应缺少 isFake 字段');
    } catch (err) {
      lastErr = err;
    }
    if (i + 1 < attempts) {
      console.warn(`[ai] 真伪判定无效（第 ${i + 1} 次），补试一次: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

/** 关键词防伪验证（组合入口）：先相关性，相关才判真伪，合并返回 */
export async function verifyKeywordHit(keyword, item) {
  const rel = await verifyRelevance(keyword, item);
  if (!isRelevantHit(rel)) {
    return { ...rel, isFake: false, confidence: 0.5, fakeReason: '' };
  }
  const fake = await checkAuthenticity(keyword, item);
  return { ...rel, ...fake };
}
