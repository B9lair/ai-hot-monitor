/**
 * AI 服务层（TypeScript）
 *
 * 本文件是项目里唯一直接依赖大模型输出的模块，因此对「模型返回值不可信」做了两层防护：
 *   1. 语法层：parseJSON() 多级容错（代码块包裹 / 前后杂文 / 字符串内裸换行 / 尾逗号）
 *   2. 语义层：zod schema 校验 + 类型安全强转（coerce01 / coerceBool），杜绝
 *      「Boolean('false') === true 把真实内容误判为假冒」这类静默故障
 */
import axios from 'axios';
import { z } from 'zod';
import { config, hasAI } from '../config.js';
import { PROMPT_VERSION, relevancePrompt, authenticityPrompt, judgePrompt } from './prompts.ts';

export { PROMPT_VERSION };

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatOptions {
  /** 覆盖默认模型（如评估法官模型） */
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** 是否要求模型返回 JSON 对象（response_format） */
  json?: boolean;
  extra?: Record<string, unknown>;
}

// ===================== 调用统计与失败重试 =====================

/**
 * AI 调用统计（进程级）。
 * 不改变任何函数签名，离线评估脚本可据此输出「调用次数 / 重试 / 失败 / token / 耗时」等成本指标。
 */
export const aiStats = {
  calls: 0,
  retries: 0,
  failures: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalMs: 0,
};

export function resetAiStats(): void {
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

/** 可重试的 HTTP 状态码：限流与服务端错误 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
/** 可重试的网络层错误码 */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNREFUSED',
]);

/**
 * 判断错误是否值得重试。
 * 认证 / 参数类错误（401 / 403 / 400）重试无意义，直接失败。
 */
export function isRetryableError(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string; message?: string };
  const status = e?.response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  if (e?.code && RETRYABLE_CODES.has(e.code)) return true;
  // 模型返回空内容可能是瞬时异常，值得重试一次
  return String(e?.message || '').includes('返回为空');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 调用 OpenRouter chat completion（带指数退避重试）。
 *
 * 重试存在的意义：单次网络抖动或 429 若直接抛错，调用方会把这条内容判为
 * 「不相关」而静默丢弃，导致真实热点永久漏报。默认重试 2 次，可用 AI_MAX_RETRIES 调整。
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (!hasAI()) {
    throw new Error('OpenRouter API Key 未配置，请在 .env 中填写 OPENROUTER_API_KEY');
  }

  const maxRetries = config.openrouter.maxRetries;
  let lastErr: unknown;

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
      const content: string | undefined = message?.content?.trim();
      if (!content) {
        // 推理模型（如 deepseek 系列）会先消耗 token 生成 reasoning，max_tokens 过小会导致
        // finish_reason=length 且 content 为空。给出更明确的诊断信息。
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
      // 指数退避 + 抖动，避免瞬时限流被连续放大
      const delay =
        Math.min(8000, config.openrouter.retryBaseMs * 2 ** attempt) +
        Math.floor(Math.random() * 250);
      console.warn(
        `[ai] 调用失败（第 ${attempt + 1} 次），${delay}ms 后重试: ${(err as Error).message}`,
      );
      await sleep(delay);
    }
  }

  aiStats.failures++;
  throw lastErr;
}

/**
 * 修复 LLM 生成的常见非法 JSON：字符串内裸换行/制表符、尾逗号。
 * 扫描时跟踪「是否位于字符串内」与转义状态，避免破坏合法内容。
 */
function repairJSON(s: string): string {
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

/**
 * 解析 JSON 响应（容错：markdown 代码块包裹 / 前后杂文 / 裸换行 / 尾逗号）
 */
export function parseJSON(text: string): unknown {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const candidates: string[] = [cleaned];
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

/**
 * 把数值夹在 0~1 之间。
 * 严格解析：只接受 number 或非空数字字符串（"0.95" 可用）；非法值回退默认值并告警，
 * 避免「模型返回非数字 → 静默兜底成 0 → 被误判为不相关」而毫无痕迹。
 */
export function coerce01(v: unknown, fallback = 0, field = ''): number {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  if (field) console.warn(`[ai] 字段 ${field} 非法（${JSON.stringify(v)}），已回退默认值 ${fallback}`);
  return fallback;
}

/**
 * 严格布尔解析：模型可能把布尔值返回成字符串。
 * 修复 `Boolean('false') === true` 导致「真实内容被误判为疑似假冒、从而不发送通知」的静默故障。
 */
export function coerceBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '真'].includes(s)) return true;
    if (['false', '0', 'no', 'n', '否', '假', ''].includes(s)) return false;
  }
  return fallback;
}

/** 宽松文本：仅接受字符串，其余按原样降级（数字/布尔转字符串，对象丢弃） */
function coerceText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// ===================== LLM 输出 schema（zod 语义校验） =====================

/** 字段级 1~5 分（非法值回退 1） */
function coerceScore15(v: unknown): number {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 1;
}

/** 相关性判定结果（与真伪判定解耦，可独立评估 / 独立调优） */
export interface RelevanceResult {
  relevance: number;
  keywordMentioned: boolean;
  matchType: string;
  summary: string;
  relevanceReason: string;
}

/** 真伪判定结果（与相关性判定解耦） */
export interface AuthenticityResult {
  isFake: boolean;
  confidence: number;
  fakeReason: string;
}

/** 相关性 + 真伪的合并结果（对业务调用方保持单一入口） */
export interface VerifyResult extends RelevanceResult, AuthenticityResult {}

export interface JudgeResult {
  summaryScore: number;
  reasonScore: number;
  comment: string;
}

/**
 * 原始返回字段全部**可选**（模型少给字段属常见情况），
 * 再由 transform 统一归一化并补默认值 —— 这样字段缺失不会让整体校验失败。
 */
const rawVerifySchema = z
  .object({
    relevance: z.unknown(),
    keywordMentioned: z.unknown(),
    matchType: z.unknown(),
    summary: z.unknown(),
    relevanceReason: z.unknown(),
    isFake: z.unknown(),
    confidence: z.unknown(),
    fakeReason: z.unknown(),
  })
  .partial();

export const verifyResultSchema = rawVerifySchema.transform(
  (o): VerifyResult => ({
    relevance: coerce01(o.relevance, 0, 'relevance'),
    keywordMentioned: coerceBool(o.keywordMentioned, false),
    matchType: coerceText(o.matchType),
    summary: coerceText(o.summary),
    relevanceReason: coerceText(o.relevanceReason),
    isFake: coerceBool(o.isFake, false),
    confidence: coerce01(o.confidence, 0.5, 'confidence'),
    fakeReason: coerceText(o.fakeReason),
  }),
);

const rawJudgeSchema = z
  .object({
    summaryScore: z.unknown(),
    reasonScore: z.unknown(),
    comment: z.unknown(),
  })
  .partial();

export const judgeResultSchema = rawJudgeSchema.transform(
  (o): JudgeResult => ({
    summaryScore: coerceScore15(o.summaryScore),
    reasonScore: coerceScore15(o.reasonScore),
    comment: coerceText(o.comment),
  }),
);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验并归一化「相关性 + 防伪」模型输出。
 * 模型返回非对象（如数组/字符串）时按默认值兜底并告警，避免整轮流程崩溃。
 */
export function parseVerifyResult(raw: unknown): VerifyResult {
  if (!isPlainObject(raw)) {
    console.warn(`[ai] 相关性判定返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`);
    return verifyResultSchema.parse({});
  }
  return verifyResultSchema.parse(raw);
}

/** 校验并归一化「AI 法官」输出 */
export function parseJudgeResult(raw: unknown): JudgeResult {
  if (!isPlainObject(raw)) {
    console.warn(`[ai] 法官返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`);
    return judgeResultSchema.parse({});
  }
  return judgeResultSchema.parse(raw);
}

// ===================== 拆分后的两个判定 schema =====================

/** 相关性判定原始字段（全部可选，字段缺失不会让整体校验失败） */
const rawRelevanceSchema = z
  .object({
    relevance: z.unknown(),
    keywordMentioned: z.unknown(),
    matchType: z.unknown(),
    summary: z.unknown(),
    relevanceReason: z.unknown(),
  })
  .partial();

export const relevanceResultSchema = rawRelevanceSchema.transform(
  (o): RelevanceResult => ({
    relevance: coerce01(o.relevance, 0, 'relevance'),
    keywordMentioned: coerceBool(o.keywordMentioned, false),
    matchType: coerceText(o.matchType),
    summary: coerceText(o.summary),
    relevanceReason: coerceText(o.relevanceReason),
  }),
);

/** 真伪判定原始字段 */
const rawAuthenticitySchema = z
  .object({
    isFake: z.unknown(),
    confidence: z.unknown(),
    fakeReason: z.unknown(),
  })
  .partial();

export const authenticityResultSchema = rawAuthenticitySchema.transform(
  (o): AuthenticityResult => ({
    isFake: coerceBool(o.isFake, false),
    confidence: coerce01(o.confidence, 0.5, 'confidence'),
    fakeReason: coerceText(o.fakeReason),
  }),
);

export function parseRelevanceResult(raw: unknown): RelevanceResult {
  if (!isPlainObject(raw)) {
    console.warn(
      `[ai] 相关性判定返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`,
    );
    return relevanceResultSchema.parse({});
  }
  return relevanceResultSchema.parse(raw);
}

export function parseAuthenticityResult(raw: unknown): AuthenticityResult {
  if (!isPlainObject(raw)) {
    console.warn(
      `[ai] 真伪判定返回的不是 JSON 对象（${Array.isArray(raw) ? 'array' : typeof raw}），已按默认值兜底`,
    );
    return authenticityResultSchema.parse({});
  }
  return authenticityResultSchema.parse(raw);
}

// ===================== 关键词与相关性工具 =====================

/** 拆分关键词为 token（按空白/常见分隔符；连字符等保留，如 GPT-5） */
export function keywordTokens(keyword: string): string[] {
  return String(keyword || '')
    .split(/[\s,，、;；:：/|｜+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 廉价预过滤：标题/摘要命中关键词「任一有效 token」即放行（多词关键词更宽松）。
 * 有效 token = 长度>=2 且非纯数字/小数（如 "4.6" 不作为独立匹配词），
 * 避免 "Claude Sonnet 4.6" 因命中 "4.6" 而误放行无关内容。
 */
export function mentionsKeyword(
  item: { title?: string; snippet?: string },
  keyword: string,
  extras: string[] = [],
): boolean {
  const tokens = keywordTokens(keyword);
  for (const e of extras || []) tokens.push(...keywordTokens(e));
  if (tokens.length === 0) return true;
  const haystack = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  const lowered = tokens.map((t) => t.toLowerCase());
  const valid = lowered.filter((t) => t.length >= 2 && !/^\d+(\.\d+)?$/.test(t));
  const pool = valid.length ? valid : lowered;
  return pool.some((t) => haystack.includes(t));
}

/**
 * 相关性判定：AI 只输出 relevance 分数，服务端用阈值判定是否「相关」。
 * 消除 AI 布尔 isRelevant 与分数不一致的问题。
 */
export function isRelevantHit(
  result: { relevance?: unknown } | null | undefined,
  threshold: number = config.openrouter.relevanceThreshold,
): boolean {
  const r = Number(result?.relevance);
  return Number.isFinite(r) && r >= threshold;
}

// ===================== AI 能力 =====================

/**
 * 相关性判定（独立调用）：只回答「与关键词的相关程度」。
 * 与真伪判定拆开后，两个任务互不干扰，可分别评估与独立调优。
 */
export async function verifyRelevance(
  keyword: string,
  item: { title: string; snippet?: string; source: string },
): Promise<RelevanceResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是一个严谨的信息相关性审核助手，只输出 JSON。' },
    { role: 'user', content: relevancePrompt(keyword, item) },
  ];
  // 网络层重试由 chat() 负责；这里处理「调用成功但结构无效」的语义异常。
  // 若直接兜底成 relevance=0，等价于静默漏掉一条真热点，因此宁可补试后抛错，
  // 交由上层降级为关键词匹配（见 services/monitor.js）。
  const attempts = 2;
  let lastErr: unknown = new Error('AI 相关性判定失败');
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
      console.warn(`[ai] 相关性判定无效（第 ${i + 1} 次），补试一次: ${(lastErr as Error).message}`);
    }
  }
  throw lastErr;
}

/**
 * 真伪判定（独立调用）：只回答「是否疑似假冒 / 谣言 / 标题党」。
 * 业务侧仅对「已判定相关」的条目调用，避免为大量不相关条目浪费 token。
 */
export async function checkAuthenticity(
  keyword: string,
  item: { title: string; snippet?: string; source: string },
): Promise<AuthenticityResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是一个严谨的信息真实性审核助手，只输出 JSON。' },
    { role: 'user', content: authenticityPrompt(keyword, item) },
  ];
  const attempts = 2;
  let lastErr: unknown = new Error('AI 真伪判定失败');
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
      console.warn(`[ai] 真伪判定无效（第 ${i + 1} 次），补试一次: ${(lastErr as Error).message}`);
    }
  }
  throw lastErr;
}

/**
 * 关键词防伪验证（组合入口，对调用方保持兼容）：
 *   1. 先做相关性判定；
 *   2. 仅当相关性过阈值时才做真伪判定（省 token，且避免两个任务互相干扰）；
 *   3. 合并为完整的 VerifyResult 返回。
 */
export async function verifyKeywordHit(
  keyword: string,
  item: { title: string; snippet?: string; source: string },
): Promise<VerifyResult> {
  const rel = await verifyRelevance(keyword, item);
  if (!isRelevantHit(rel)) {
    // 不相关的内容无需再判真伪
    return { ...rel, isFake: false, confidence: 0.5, fakeReason: '' };
  }
  const fake = await checkAuthenticity(keyword, item);
  return { ...rel, ...fake };
}

/**
 * AI 法官：评估一条相关性判定结果的摘要/理由质量（1~5 分），用于离线回归。
 * 使用独立法官模型（config.openrouter.judgeModel，缺省回退到筛选模型），避免"自评偏差"。
 */
export async function judgeQuality(
  keyword: string,
  item: { title: string; snippet?: string },
  result: Pick<VerifyResult, 'relevance' | 'matchType' | 'summary' | 'relevanceReason'>,
): Promise<JudgeResult> {
  const prompt = judgePrompt(keyword, item, result);

  const text = await chat(
    [
      { role: 'system', content: '你是一个严谨的评估助手，只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, max_tokens: 800, model: config.openrouter.judgeModel || undefined },
  );
  return parseJudgeResult(parseJSON(text));
}
