import { prisma } from '../db.js';
import { searchAll } from '../sources/index.js';
import { computeHotScore, normalizeUrl } from '../sources/utils.js';
import { verifyKeywordHit, isRelevantHit, mentionsKeyword } from '../ai/openrouter.ts';
import { expandQuery } from '../ai/query-expansion.ts';
import { config, hasAI } from '../config.js';
import { notifyBrowser } from './notifier.js';

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
 *
 * 容错原则：AI 校验失败时**降级为关键词字面匹配**，而不是丢弃该条，
 * 避免网络抖动导致真实热点永久漏报（返回值 degraded 字段记录降级条数）。
 *
 * @param {object} keywordRecord
 * @param {(p: {total: number, done: number}) => void} [onProgress] 校验进度回调
 */
export async function runMonitor(keywordRecord, onProgress) {
  const keyword = keywordRecord.text;
  // 查询扩展：为关键词生成同义/变体查询词，提高搜索召回（带缓存）
  const expansions = await expandQuery(keyword);
  // 采集 + 第一/二层过滤在 searchAll 内完成（每源保留条数由 config 控制）
  const items = await searchAll(keyword, undefined, expansions);

  // 为每条计算归一化 URL（URL 去重依据）
  for (const it of items) it.normalizedUrl = normalizeUrl(it.url);

  // 批量去重（精确 url + 归一化 normalizedUrl 双重比对，一次查询）
  const urls = items.map((i) => i.url).filter(Boolean);
  const normUrls = items.map((i) => i.normalizedUrl).filter(Boolean);
  const existingRows = urls.length || normUrls.length
    ? await prisma.alert.findMany({
        where: { OR: [{ url: { in: urls } }, { normalizedUrl: { in: normUrls } }] },
        select: { url: true, normalizedUrl: true },
      })
    : [];
  const existingUrl = new Set(existingRows.map((a) => a.url));
  const existingNorm = new Set(existingRows.map((a) => a.normalizedUrl).filter(Boolean));
  const fresh = items.filter(
    (i) => i.url && !existingUrl.has(i.url) && !existingNorm.has(i.normalizedUrl),
  );

  // 廉价预过滤：丢弃标题/摘要完全不含关键词/扩展词任一有效 token 的条目（账号查询跳过）
  const candidates =
    !keyword.startsWith('@') && config.openrouter.preFilterKeyword
      ? fresh.filter((i) => mentionsKeyword(i, keyword, expansions))
      : fresh;

  const total = candidates.length;
  let done = 0;
  let verified = 0;
  let alerted = 0;
  let degraded = 0; // AI 不可用（未配置 Key 或调用失败）而走关键词兜底的条数
  const newAlerts = []; // 本轮新命中，供邮件聚合
  onProgress?.({ total, done });

  /**
   * 降级兜底结果：AI 不可用（未配置 Key 或调用失败）时按关键词字面匹配判定。
   * 命中即取阈值分（刚好过入库线），保证「AI 抖动」不会让真实热点被静默丢弃。
   */
  const fallbackResult = (item) => {
    const matched = mentionsKeyword(item, keyword, expansions);
    return {
      relevance: matched ? config.openrouter.relevanceThreshold : 0.2,
      keywordMentioned: matched,
      matchType: matched ? '直接相关' : '不相关',
      isFake: false,
      confidence: 0.5,
      summary: item.snippet || item.title,
      relevanceReason: matched ? 'AI 校验不可用，降级为关键词字面匹配（命中即视为相关）' : '',
      fakeReason: '',
    };
  };

  // 受控并发执行 AI 校验
  const checked = await mapLimit(candidates, VERIFY_CONCURRENCY, async (item) => {
    try {
      if (hasAI()) {
        return { item, result: await verifyKeywordHit(keyword, item), degraded: false };
      }
      // 未配置 API Key：走关键词兜底
      degraded++;
      return { item, result: fallbackResult(item), degraded: true };
    } catch (err) {
      // 关键：调用失败不再静默丢弃（原先 return null 会让真实热点永久漏报）
      degraded++;
      console.warn(`[monitor] AI 校验失败，降级为关键词匹配（${item.source}）: ${err.message}`);
      return { item, result: fallbackResult(item), degraded: true };
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
    const created = await prisma.alert.create({
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
        normalizedUrl: item.normalizedUrl || null,
      },
    });

    if (!result.isFake) {
      alerted++;
      const alertWithKeyword = { ...created, keywordText: keyword };
      newAlerts.push(alertWithKeyword);

      // 实时浏览器通知（按用户定向推送）
      await notifyBrowser({
        type: 'alert',
        title: `【${keyword}】新动态`,
        content: `${item.title}\n${result.summary}`,
        url: item.url,
      });
    }
  }

  // 记录本次运行时间：调度器据此按 intervalMin 判断该关键词下次到期时间（失败不记录，下轮重试）
  await prisma.keyword
    .update({ where: { id: keywordRecord.id }, data: { lastRunAt: new Date() } })
    .catch(() => {});

  return { keyword, scanned: items.length, verified, alerted, degraded, alerts: newAlerts };
}

/**
 * 对已启用的所有关键词执行一轮监控（仅执行已到期的关键词）。
 * 每个关键词按自身 intervalMin + lastRunAt 判断是否到期，避免无差别全量抓取。
 * 命中仅入库 + 浏览器通知；邮件汇总由 email.js 的 processEmailDigests 按用户间隔独立发送。
 */
export async function runAllMonitors() {
  const now = Date.now();
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });

  // 到期判定：从未运行过（lastRunAt 为空）→ 立即执行；否则距上次运行 ≥ intervalMin 才执行
  const due = keywords.filter((k) => {
    if (!k.lastRunAt) return true;
    const elapsedMin = (now - new Date(k.lastRunAt).getTime()) / 60000;
    return elapsedMin >= k.intervalMin;
  });

  if (!due.length) return [];

  const results = [];

  for (const kw of due) {
    try {
      results.push(await runMonitor(kw));
    } catch (err) {
      console.error(`[monitor] 关键词「${kw.text}」监控失败:`, err.message);
    }
  }

  return results;
}
