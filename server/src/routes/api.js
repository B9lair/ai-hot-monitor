import { Router } from 'express';
import { prisma } from '../db.js';
import { runMonitor } from '../services/monitor.js';
import { runDiscover } from '../services/discover.js';
import { hasAI, hasSMTP, config } from '../config.js';

const router = Router();

// ===== 关键词 CRUD =====
router.get('/keywords', async (_req, res) => {
  const list = await prisma.keyword.findMany({
    orderBy: { createdAt: 'desc' },
    include: { alerts: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  res.json(list);
});

router.post('/keywords', async (req, res) => {
  const { text, intervalMin } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '关键词不能为空' });
  const kw = await prisma.keyword.upsert({
    where: { text: text.trim() },
    update: { enabled: true, intervalMin: intervalMin || 5 },
    create: { text: text.trim(), intervalMin: intervalMin || 5 },
  });
  res.json(kw);
});

router.patch('/keywords/:id', async (req, res) => {
  const { id } = req.params;
  const { enabled, intervalMin } = req.body || {};
  const data = {};
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (intervalMin) data.intervalMin = intervalMin;
  const kw = await prisma.keyword.update({ where: { id }, data });
  res.json(kw);
});

router.delete('/keywords/:id', async (req, res) => {
  await prisma.keyword.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// 立即执行一次关键词监控
router.post('/keywords/:id/run', async (req, res) => {
  const kw = await prisma.keyword.findUnique({ where: { id: req.params.id } });
  if (!kw) return res.status(404).json({ error: '关键词不存在' });
  const result = await runMonitor(kw);
  res.json(result);
});

// ===== 热点范围 CRUD =====
router.get('/topics', async (_req, res) => {
  const list = await prisma.topic.findMany({
    orderBy: { createdAt: 'desc' },
    include: { hotspots: { orderBy: { hotness: 'desc' }, take: 10 } },
  });
  res.json(list);
});

router.post('/topics', async (req, res) => {
  const { text, intervalMin } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '范围不能为空' });
  const topic = await prisma.topic.upsert({
    where: { text: text.trim() },
    update: { enabled: true, intervalMin: intervalMin || 15 },
    create: { text: text.trim(), intervalMin: intervalMin || 15 },
  });
  res.json(topic);
});

router.patch('/topics/:id', async (req, res) => {
  const { id } = req.params;
  const { enabled, intervalMin } = req.body || {};
  const data = {};
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (intervalMin) data.intervalMin = intervalMin;
  const topic = await prisma.topic.update({ where: { id }, data });
  res.json(topic);
});

router.delete('/topics/:id', async (req, res) => {
  await prisma.topic.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// 立即执行一次热点发现
router.post('/topics/:id/run', async (req, res) => {
  const topic = await prisma.topic.findUnique({ where: { id: req.params.id } });
  if (!topic) return res.status(404).json({ error: '范围不存在' });
  const result = await runDiscover(topic);
  res.json(result);
});

// ===== 查询：所有命中 / 热点 / 通知 =====
router.get('/alerts', async (_req, res) => {
  const list = await prisma.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { keyword: { select: { text: true } } },
  });
  res.json(list);
});

router.get('/hotspots', async (_req, res) => {
  const list = await prisma.hotspot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { topic: { select: { text: true } } },
  });
  res.json(list);
});

router.get('/notifications', async (_req, res) => {
  const list = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(list);
});

// ===== 状态 =====
router.get('/status', (_req, res) => {
  res.json({
    hasAI: hasAI(),
    hasSMTP: hasSMTP(),
    model: config.openrouter.model,
    intervals: config.intervals,
    sources: {
      twitter: Boolean(config.sources.twitterApiKey),
    },
  });
});

export default router;
