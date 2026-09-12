import { prisma } from '../db.js';
import { searchAll } from '../sources/index.js';
import { verifyKeywordHit } from '../ai/openrouter.js';
import { hasAI } from '../config.js';
import { sendNotification } from './notifier.js';

/**
 * 关键词监控主流程：
 * 1. 从多源搜索关键词相关内容
 * 2. AI 防伪验证（真实相关 + 非假冒）
 * 3. 命中则入库并通知
 */
export async function runMonitor(keywordRecord) {
  const keyword = keywordRecord.text;
  const items = await searchAll(keyword, 10);

  let verified = 0;
  let alerted = 0;

  for (const item of items) {
    // 已存在则跳过
    const exists = await prisma.alert.findUnique({ where: { url: item.url } });
    if (exists) continue;

    let result;
    if (hasAI()) {
      result = await verifyKeywordHit(keyword, item);
    } else {
      // 无 AI 时退化为纯关键词匹配
      const matched = item.title.includes(keyword) || (item.snippet || '').includes(keyword);
      result = { isRelevant: matched, isFake: false, confidence: 0.6, summary: item.snippet || item.title };
    }

    if (!result.isRelevant) continue;
    verified++;

    // 命中且非假冒 -> 入库 + 通知
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
