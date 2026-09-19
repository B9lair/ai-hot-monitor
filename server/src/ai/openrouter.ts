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

/**
 * 调用 OpenRouter chat completion
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (!hasAI()) {
    throw new Error('OpenRouter API Key 未配置，请在 .env 中填写 OPENROUTER_API_KEY');
  }

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

export interface VerifyResult {
  relevance: number;
  keywordMentioned: boolean;
  matchType: string;
  summary: string;
  relevanceReason: string;
  isFake: boolean;
  confidence: number;
  fakeReason: string;
}

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
 * 关键词防伪验证：判断一条内容与关键词的相关度，并识别假冒/谣言。
 * 只输出连续的 relevance 分数 + 证据化理由，不再输出 isRelevant 布尔；
 * 返回值经 zod 校验，字段类型与取值范围有保证。
 */
export async function verifyKeywordHit(
  keyword: string,
  item: { title: string; snippet?: string; source: string },
): Promise<VerifyResult> {
  const prompt = `你是一个严格的信息相关性审核助手。请判断下面这条内容与关键词「${keyword}」的关联程度，并评估其真实性。

【相关性判定标准（务必严格遵守）】
1. 只有当内容【明确提及关键词本身】或【无歧义地指向关键词所指的同一主体/产品/事件】，且关键词是该内容的【核心主题】时，才判为「直接相关」并给高 relevance（>=0.7）。
2. 仅提到同一领域/同一生态、但【未提及关键词本身】的内容（例如关键词是「Claude Sonnet 4.6」，内容只讲「OpenClaw」而没有提到 Claude Sonnet 4.6）→ 判为「不相关」，relevance 应 <0.3。
3. 只是顺带提一句、或在标题/摘要边缘出现关键词但主体无关 → 「间接相关」，relevance 给 0.3~0.6。
4. 判断依据必须来自「标题」和「摘要」里能指出的具体文字，不能臆测或脑补。

【校准示例】
- 关键词「Claude Sonnet 4.6」，标题「Anthropic 发布 Claude Sonnet 4.6，推理能力大幅提升」→ relevance 0.95，matchType "直接相关"，keywordMentioned true。
- 关键词「Claude Sonnet 4.6」，标题「OpenClaw 推出新的 agent 框架」，全文未提 Claude Sonnet 4.6 → relevance 0.05，matchType "不相关"，keywordMentioned false。

【待审核内容】
标题：${item.title}
摘要：${item.snippet || '（无）'}
来源：${item.source}

请严格只返回 JSON（不要输出任何其他文字），格式：
{
  "relevance": 0.0~1.0,           // 与关键词「${keyword}」的相关度（0 完全不相关，1 完全相关）
  "keywordMentioned": true/false, // 标题或摘要中是否明确提及关键词本身
  "matchType": "直接相关|间接相关|不相关",
  "summary": "一句话总结：该内容相对于关键词「${keyword}」讲了什么（核心要点 + 与关键词的关联点）",
  "relevanceReason": "1~2句，引用标题/摘要中的具体文字，说明为什么给出这个相关度",
  "isFake": false/true,           // 是否疑似假冒、谣言、标题党或虚假信息
  "confidence": 0.0~1.0,          // 真实性判断置信度
  "fakeReason": "若 isFake 为 true，说明为什么疑似假冒/谣言/标题党；否则输出空字符串"
}`;

  const text = await chat(
    [
      { role: 'system', content: '你是一个严谨的信息相关性审核助手，只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, max_tokens: 2000 },
  );
  return parseVerifyResult(parseJSON(text));
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
  const prompt = `你是一个严格的评估助手。请评估下面这条「相关性判定结果」的质量，从「是否围绕关键词、是否给出明确判断依据、是否可读」三个维度打分。

关键词：${keyword}
内容标题：${item.title}
内容摘要：${item.snippet || '（无）'}
AI 给出的相关度：${result.relevance}
AI 给出的匹配类型：${result.matchType}
AI 给出的摘要：${result.summary}
AI 给出的相关理由：${result.relevanceReason}

评分参考：
- summaryScore：摘要是否围绕「该内容与关键词的关联点」展开（而不是泛泛介绍内容本身）？1=纯介绍内容、未提关键词；5=精准点出与关键词的关联。
- reasonScore：理由是否引用标题/摘要中的具体文字作为判断依据？1=无依据的空话；5=证据充分、逻辑清晰。

请严格只返回 JSON（不要输出任何其他文字），格式：
{ "summaryScore": 1~5, "reasonScore": 1~5, "comment": "一句话点评，指出主要问题" }`;

  const text = await chat(
    [
      { role: 'system', content: '你是一个严谨的评估助手，只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, max_tokens: 800, model: config.openrouter.judgeModel || undefined },
  );
  return parseJudgeResult(parseJSON(text));
}
