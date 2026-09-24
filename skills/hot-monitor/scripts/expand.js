/**
 * 查询扩展（Query Expansion，JS 版，移植自 server/src/ai/query-expansion.ts）
 * 用 AI 为关键词生成同义/变体查询词以提高检索召回。
 */
import { z } from 'zod';
import { chat, parseJSON } from './ai.js';
import { queryExpansionPrompt } from './prompts.js';
import { config, hasAI } from './config.js';

/** 扩展词内存缓存：keyword -> string[] */
const cache = new Map();

/** 模型可能返回 ["a","b"] 或 { queries: ["a","b"] }，统一归一化为字符串数组 */
const queriesSchema = z.unknown().transform((v) => {
  const raw = Array.isArray(v)
    ? v
    : v !== null && typeof v === 'object'
      ? v.queries
      : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : ''))
    .map((s) => s.trim())
    .filter(Boolean);
});

/** 为关键词生成同义/变体查询词（带缓存） */
export async function expandQuery(keyword) {
  const k = String(keyword || '').trim();
  if (!k || k.startsWith('@')) return [];
  if (!config.sources.queryExpand || !hasAI()) return [];
  const cached = cache.get(k);
  if (cached) return cached;

  const limit = config.sources.queryExpandLimit;
  const prompt = queryExpansionPrompt(k, limit);

  try {
    const text = await chat(
      [
        { role: 'system', content: '你是一个搜索查询扩展助手，只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { json: true, max_tokens: 500 },
    );
    const parsed = queriesSchema.parse(parseJSON(text));
    const out = [...new Set(parsed.filter((s) => s !== k))].slice(0, limit);
    cache.set(k, out);
    return out;
  } catch (err) {
    console.warn(`[query-expansion] 生成「${k}」扩展词失败:`, err.message);
    cache.set(k, []);
    return [];
  }
}

/** 清空扩展词缓存 */
export function clearQueryExpansionCache() {
  cache.clear();
}
