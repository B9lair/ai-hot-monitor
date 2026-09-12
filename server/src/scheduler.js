import cron from 'node-cron';
import { config } from './config.js';
import { runAllMonitors } from './services/monitor.js';
import { runAllDiscovers } from './services/discover.js';
import { broadcastNotification } from './socket.js';

/**
 * 初始化定时任务
 * 关键词监控：默认每 5 分钟
 * 热点发现：默认每 15 分钟
 */
export function initScheduler() {
  const monitorMin = config.intervals.monitorMin;
  const discoverMin = config.intervals.discoverMin;

  // 关键词监控
  cron.schedule(`*/${monitorMin} * * * *`, async () => {
    console.log('[scheduler] 执行关键词监控...');
    const results = await runAllMonitors();
    for (const r of results) {
      if (r.alerted > 0) {
        broadcastNotification({ type: 'monitor_result', data: r });
      }
    }
  });

  // 热点发现
  cron.schedule(`*/${discoverMin} * * * *`, async () => {
    console.log('[scheduler] 执行热点发现...');
    await runAllDiscovers();
    broadcastNotification({ type: 'hotspot_update', data: { at: Date.now() } });
  });

  console.log(`[scheduler] 已启动：监控每 ${monitorMin} 分钟，发现每 ${discoverMin} 分钟`);
}
