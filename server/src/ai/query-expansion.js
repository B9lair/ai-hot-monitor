import { chat, parseJSON } from './openrouter.js';
import { config, hasAI } from '../config.js';

/** 扩展词内存缓存：keyword -> string[]（进程级，重启后按需重新生成，成本极低） */
const cache = new Map();

/**
 * 为关键词生成同义/变体查询词，用于提高搜索召回（Query Expansion）。
 * - 账号查询（@ 开头）不扩展；
 * - 关闭开关或无 AI 时返回空数组；
 * - 结果带内存缓存，每个关键词只生成一次。
 * @param {string} keyword
 * @returns {Promise<string[]>}
 */
export async function expandQuery(keyword) {
  const k = String(keyword || '').trim();
  if (!k || k.startsWith('@')) return [];
  if (!config.sources.queryExpand || !hasAI()) return [];
  if (cache.has(k)) return cache.get(k);

  const limit = config.sources.queryExpandLimit;
  const prompt = `你是搜索查询扩展助手。给定用户关注的关键词，请生成最多 ${limit} 个「同义 / 变体 / 更完整表述」的查询词，用于提高搜索召回（换一种说法、补全主体、口语/书面变体均可）。

关键词：${k}

要求：
1. 每个查询词都应仍指向同一主题/主体，不要偏离原意；
2. 不要与关键词完全相同，不要生成过于宽泛的词；
3. 直接返回 JSON 对象。

示例：
- 输入「鱼皮的 AI 导航」→ {"queries": ["程序员鱼皮的 AI 导航", "AI 导航 鱼皮", "鱼皮 AI 编程教程"]}
- 输入「GPT-5」→ {"queries": ["GPT-5 发布", "OpenAI GPT-5", "GPT-5 模型"]}

请严格只返回 JSON（不要输出任何其他文字）。`;

  try {
    const text = await chat(
      [
        { role: 'system', content: '你是一个搜索查询扩展助手，只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { json: true, max_tokens: 500 },
    );
    const parsed = parseJSON(text);
    const arr = Array.isArray(parsed) ? parsed : parsed?.queries;
    const out = [
      ...new Set(
        (Array.isArray(arr) ? arr : [])
          .map((s) => String(s).trim())
          .filter((s) => s && s !== k),
      ),
    ].slice(0, limit);
    cache.set(k, out);
    return out;
  } catch (err) {
    console.warn(`[query-expansion] 生成「${k}」扩展词失败:`, err.message);
    cache.set(k, []);
    return [];
  }
}

/** 清空扩展词缓存（测试/调试用） */
export function clearQueryExpansionCache() {
  cache.clear();
}
