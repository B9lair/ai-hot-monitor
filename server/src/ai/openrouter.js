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
      model: config.openrouter.model,
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

/**
 * 关键词防伪验证：判断一条内容是否真实相关、是否假冒/谣言
 * @param {string} keyword
 * @param {{title: string, snippet?: string, source: string}} item
 * @returns {Promise<{isRelevant: boolean, isFake: boolean, confidence: number, summary: string}>}
 */
export async function verifyKeywordHit(keyword, item) {
  const prompt = `你是一个信息真实性审核助手。请判断下面这条内容是否与关键词「${keyword}」真实相关，以及它是否属于假冒、谣言、标题党或虚假信息。

内容标题：${item.title}
内容摘要：${item.snippet || '（无）'}
来源：${item.source}

请严格返回 JSON（不要包含其他文字），格式：
{
  "isRelevant": true/false,   // 是否真的与关键词「${keyword}」相关
  "isFake": false/true,        // 是否是假冒、谣言、标题党或虚假信息
  "confidence": 0.0~1.0,       // 你的判断置信度
  "summary": "一句话中文总结该内容的真实要点"
}`;

  const text = await chat(
    [
      { role: 'system', content: '你是一个严谨的信息真实性审核助手，只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, max_tokens: 2000 },
  );
  const result = parseJSON(text);
  return {
    isRelevant: Boolean(result.isRelevant),
    isFake: Boolean(result.isFake),
    confidence: Number(result.confidence ?? 0.5),
    summary: String(result.summary ?? ''),
  };
}

/**
 * 热点聚合：对一批候选内容去重、分类、提炼主题、生成摘要
 * @param {string} topic 关注范围
 * @param {Array<{title: string, snippet?: string, source: string, url: string}>} items
 * @returns {Promise<Array<{title: string, summary: string, category: string, hotness: number}>>}
 */
export async function aggregateHotspots(topic, items) {
  const candidates = items
    .slice(0, 30)
    .map((it, i) => `${i + 1}. [${it.source}] ${it.title}${it.snippet ? ' | ' + it.snippet : ''}`)
    .join('\n');

  const prompt = `你是一个热点聚合分析助手。以下是关于「${topic}」的候选信息列表：

${candidates}

请提炼出其中的热点主题（去重合并相似内容），最多输出 10 条，按热度从高到低排序。严格返回 JSON（不要包含其他文字）：
{
  "hotspots": [
    {
      "title": "热点标题（中文，简洁）",
      "category": "分类（如：模型发布/产品动态/融资/技术突破/行业政策等）",
      "summary": "一句话中文总结",
      "hotness": 0~100   // 综合热度评分
    }
  ]
}`;

  const text = await chat(
    [
      { role: 'system', content: '你是一个专业的热点聚合分析师，只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, max_tokens: 4000 },
  );
  const result = parseJSON(text);
  return Array.isArray(result.hotspots) ? result.hotspots : [];
}
