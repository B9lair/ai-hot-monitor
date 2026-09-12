import { prisma } from '../db.js';
import { discoverAll } from '../sources/index.js';
import { aggregateHotspots } from '../ai/openrouter.js';
import { hasAI } from '../config.js';
import { sendNotification } from './notifier.js';

/**
 * 热点发现主流程：
 * 1. 从多榜单 + 搜索抓取指定范围内容
 * 2. AI 聚合（去重/分类/提炼/摘要）
 * 3. 入库，新热点通知
 */
export async function runDiscover(topicRecord) {
  const topic = topicRecord.text;
  const items = await discoverAll(topic, 10);

  let hotspots = [];
  if (hasAI() && items.length > 0) {
    hotspots = await aggregateHotspots(topic, items);
  } else {
    // 无 AI 时退化为直接去重入库
    hotspots = items.slice(0, 10).map((it) => ({
      title: it.title,
      summary: it.snippet || '',
      category: '未分类',
      hotness: 50,
      url: it.url,
      source: it.source,
      publishedAt: it.publishedAt,
    }));
  }

  let created = 0;
  let alerted = 0;
  for (const h of hotspots) {
    // 聚合结果可能不含 url（纯 AI 提炼），用标题+话题去重
    const exists = await prisma.hotspot.findFirst({
      where: { topicId: topicRecord.id, title: h.title },
    });
    if (exists) continue;

    await prisma.hotspot.create({
      data: {
        topicId: topicRecord.id,
        title: h.title,
        url: h.url || '',
        source: h.source || 'AI聚合',
        snippet: null,
        summary: h.summary || '',
        category: h.category || null,
        hotness: typeof h.hotness === 'number' ? h.hotness : null,
        publishedAt: h.publishedAt || null,
      },
    });
    created++;

    // 高热度（>=70）触发通知
    if ((h.hotness ?? 0) >= 70) {
      await sendNotification({
        type: 'hotspot',
        title: `【${topic}】热点：${h.title}`,
        content: h.summary || h.title,
        url: h.url || undefined,
      });
      alerted++;
    }
  }

  return { topic, scanned: items.length, created, alerted };
}

/**
 * 对已启用的所有范围执行一轮热点发现
 */
export async function runAllDiscovers() {
  const topics = await prisma.topic.findMany({ where: { enabled: true } });
  const results = [];
  for (const t of topics) {
    try {
      results.push(await runDiscover(t));
    } catch (err) {
      console.error(`[discover] 范围「${t.text}」发现失败:`, err.message);
    }
  }
  return results;
}
