import { prisma } from '../db.js';
import { searchAll } from '../sources/index.js';
import { computeHotScore, normalizeUrl } from '../sources/utils.js';
import { verifyKeywordHit, isRelevantHit, mentionsKeyword } from '../ai/openrouter.js';
import { expandQuery } from '../ai/query-expansion.js';
import { config, hasAI } from '../config.js';
import { notifyBrowser } from './notifier.js';
import { sendAlertEmails } from './email.js';

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
  const newAlerts = []; // 本轮新命中，供邮件聚合
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

      // 即时模式：每条命中立即发一封邮件
      if (config.email.mode === 'instant') {
        await sendAlertEmails([alertWithKeyword], { batchKey: `instant:${created.id}` });
      }
    }
  }

  return { keyword, scanned: items.length, verified, alerted, alerts: newAlerts };
}

/**
 * 对已启用的所有关键词执行一轮监控。
 * 轮末按 digest 模式把本轮全部命中聚合成邮件发送。
 */
export async function runAllMonitors() {
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  const results = [];
  const roundAlerts = [];
  const roundId = `digest:${Date.now()}`;

  for (const kw of keywords) {
    try {
      const r = await runMonitor(kw);
      results.push(r);
      roundAlerts.push(...(r.alerts || []));
    } catch (err) {
      console.error(`[monitor] 关键词「${kw.text}」监控失败:`, err.message);
    }
  }

  if (config.email.mode === 'digest' && roundAlerts.length) {
    try {
      await sendAlertEmails(roundAlerts, { batchKey: roundId });
    } catch (err) {
      console.error('[monitor] 邮件聚合发送失败:', err.message);
    }
  }

  return results;
}
