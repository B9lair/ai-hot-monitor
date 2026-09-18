import axios from 'axios';
import { config, hasAI } from '../config.js';

/**
 * 调用 OpenRouter chat completion
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} opts
 */
export async function chat(messages, opts = {}) {
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
  const content = message?.content?.trim();
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
 * 解析 JSON 响应（容错处理 markdown 代码块包裹）
 */
export function parseJSON(text) {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI 返回无法解析为 JSON');
  }
}

/** 把数值夹在 0~1 之间 */
function clamp01(v, d = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(1, Math.max(0, n));
}

/** 拆分关键词为 token（按空白/常见分隔符；连字符等保留，如 GPT-5） */
export function keywordTokens(keyword) {
  return String(keyword || '')
    .split(/[\s,，、;；:：/|｜+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 廉价预过滤：标题/摘要命中关键词「任一有效 token」即放行（多词关键词更宽松）。
 * 有效 token = 长度>=2 且非纯数字/小数（如 "4.6" 不作为独立匹配词），
 * 避免 "Claude Sonnet 4.6" 因命中 "4.6" 而误放行无关内容。
 * @param {object} item 内容条目
 * @param {string} keyword 原始关键词
 * @param {string[]} [extras] 额外关键词（查询扩展词），token 池取其并集
 */
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

/**
 * 相关性判定：AI 只输出 relevance 分数，服务端用阈值判定是否「相关」。
 * 消除 AI 布尔 isRelevant 与分数不一致的问题。
 */
export function isRelevantHit(result, threshold = config.openrouter.relevanceThreshold) {
  const r = Number(result?.relevance);
  return Number.isFinite(r) && r >= threshold;
}

/**
 * 关键词防伪验证：判断一条内容与关键词的相关度，并识别假冒/谣言。
 * 只输出连续的 relevance 分数 + 证据化理由，不再输出 isRelevant 布尔。
 * @param {string} keyword
 * @param {{title: string, snippet?: string, source: string}} item
 * @returns {Promise<{relevance: number, keywordMentioned: boolean, matchType: string, summary: string, relevanceReason: string, isFake: boolean, confidence: number, fakeReason: string}>}
 */
export async function verifyKeywordHit(keyword, item) {
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
  const result = parseJSON(text);
  return {
    relevance: clamp01(result.relevance),
    keywordMentioned: Boolean(result.keywordMentioned),
    matchType: String(result.matchType ?? ''),
    summary: String(result.summary ?? ''),
    relevanceReason: String(result.relevanceReason ?? ''),
    isFake: Boolean(result.isFake),
    confidence: clamp01(result.confidence, 0.5),
    fakeReason: String(result.fakeReason ?? ''),
  };
}

/**
 * AI 法官：评估一条相关性判定结果的摘要/理由质量（1~5 分），用于离线回归。
 * 使用独立法官模型（config.openrouter.judgeModel，缺省回退到筛选模型），避免"自评偏差"。
 * @returns {Promise<{summaryScore: number, reasonScore: number, comment: string}>}
 */
export async function judgeQuality(keyword, item, result) {
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
  const r = parseJSON(text);
  return {
    summaryScore: Math.min(5, Math.max(1, Number(r.summaryScore) || 1)),
    reasonScore: Math.min(5, Math.max(1, Number(r.reasonScore) || 1)),
    comment: String(r.comment ?? ''),
  };
}


