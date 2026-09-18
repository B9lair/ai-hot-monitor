import { prisma } from '../db.js';
import { searchAll } from '../sources/index.js';
import { computeHotScore } from '../sources/utils.js';
import { verifyKeywordHit, isRelevantHit, mentionsKeyword } from '../ai/openrouter.js';
import { expandQuery } from '../ai/query-expansion.js';
import { config, hasAI } from '../config.js';
import { sendNotification } from './notifier.js';

/** AI 校验并发上限（受控并发，显著缩短单轮耗时） */
const VERIFY_CONCURRENCY = 4;

/** 按给定上限并发执行，并保持结果顺序 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 关键词监控主流程：
 * 1. 从多源搜索关键词相关内容
 * 2. 批量去重 + 受控并发执行 AI 防伪验证
 * 3. 命中则入库并通知
 * @param {object} keywordRecord
 * @param {(p: {total: number, done: number}) => void} [onProgress] 校验进度回调
 */
export async function runMonitor(keywordRecord, onProgress) {
  const keyword = keywordRecord.text;
  // 查询扩展：为关键词生成同义/变体查询词，提高搜索召回（带缓存）
  const expansions = await expandQuery(keyword);
  // 采集 + 第一/二层过滤在 searchAll 内完成（每源保留条数由 config 控制）
  const items = await searchAll(keyword, undefined, expansions);

  // 批量去重（一次查询替代逐条 findUnique）
  const urls = items.map((i) => i.url).filter(Boolean);
  const existing = urls.length
    ? new Set(
        (await prisma.alert.findMany({ where: { url: { in: urls } }, select: { url: true } })).map((a) => a.url),
      )
    : new Set();
  const fresh = items.filter((i) => i.url && !existing.has(i.url));

  // 廉价预过滤：丢弃标题/摘要完全不含关键词/扩展词任一有效 token 的条目（账号查询跳过）
  const candidates =
    !keyword.startsWith('@') && config.openrouter.preFilterKeyword
      ? fresh.filter((i) => mentionsKeyword(i, keyword, expansions))
      : fresh;

  const total = candidates.length;
  let done = 0;
  let verified = 0;
  let alerted = 0;
  onProgress?.({ total, done });

  // 受控并发执行 AI 校验
  const checked = await mapLimit(candidates, VERIFY_CONCURRENCY, async (item) => {
    try {
      let result;
      if (hasAI()) {
        result = await verifyKeywordHit(keyword, item);
      } else {
        // 无 AI 时退化为纯关键词匹配
        const matched = item.title.includes(keyword) || (item.snippet || '').includes(keyword);
        result = {
          relevance: matched ? 0.8 : 0.2,
          keywordMentioned: matched,
          matchType: matched ? '直接相关' : '不相关',
          isFake: false,
          confidence: 0.6,
          summary: item.snippet || item.title,
          relevanceReason: matched ? '标题或摘要中包含关键词，按纯关键词匹配判定相关' : '',
          fakeReason: '',
        };
      }
      return { item, result };
    } catch (err) {
      console.warn(`[monitor] 校验失败（${item.source}）:`, err.message);
      return null;
    } finally {
      done++;
      onProgress?.({ total, done });
    }
  });

  // 顺序入库并通知（保持写入顺序，避免并发写库竞争）
  for (const row of checked) {
    if (!row) continue;
    const { item, result } = row;
    if (!isRelevantHit(result)) continue;
    verified++;

    // 命中即入库（假冒内容也保留，仅不通知）
    await prisma.alert.create({
      data: {
        keywordId: keywordRecord.id,
        title: item.title,
        url: item.url,
        source: item.source,
        snippet: item.snippet || null,
        summary: result.summary,
        isFake: result.isFake,
        confidence: result.confidence,
        relevance: result.relevance ?? null,
        relevanceReason: result.relevanceReason || null,
        fakeReason: result.fakeReason || null,
        author: item.author || null,
        hotScore: computeHotScore(item.source, item.metrics),
        metrics: item.metrics ? JSON.stringify(item.metrics) : null,
        publishedAt: item.publishedAt,
      },
    });

    if (!result.isFake) {
      await sendNotification({
        type: 'alert',
        title: `【${keyword}】新动态`,
        content: `${item.title}\n${result.summary}`,
        url: item.url,
      });
      alerted++;
    }
  }

  return { keyword, scanned: items.length, verified, alerted };
}

/**
 * 对已启用的所有关键词执行一轮监控
 */
export async function runAllMonitors() {
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  const results = [];
  for (const kw of keywords) {
    try {
      results.push(await runMonitor(kw));
    } catch (err) {
      console.error(`[monitor] 关键词「${kw.text}」监控失败:`, err.message);
    }
  }
  return results;
}
