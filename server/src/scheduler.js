import cron from 'node-cron';
import { config } from './config.js';
import { runAllMonitors } from './services/monitor.js';
import { processEmailDigests } from './services/email.js';
import { broadcastNotification } from './socket.js';

/**
 * 初始化定时任务
 * 1. 关键词监控：每 tickMin 分钟检查一次，各关键词按自身 intervalMin 判断是否到期
 * 2. 邮件汇总发送：每 dispatcherTickMin 分钟扫描一次，各用户按自身 emailIntervalMin 判断是否到期
 */
export function initScheduler() {
  const tickMin = config.intervals.tickMin;

  // 关键词监控：每 tickMin 分钟检查一次，runAllMonitors 内部按各关键词 intervalMin 判断是否到期
  cron.schedule(`*/${tickMin} * * * *`, async () => {
    const results = await runAllMonitors();
    for (const r of results) {
      if (r.alerted > 0) {
        // 通用刷新触发（不含标题，前端不计未读）
        broadcastNotification({ type: 'monitor_result', data: { keyword: r.keyword, alerted: r.alerted } });
      }
    }
  });

  console.log(`[scheduler] 已启动：每 ${tickMin} 分钟检查一次调度（各关键词按自身间隔执行）`);

  // 邮件汇总发送：按用户自定义间隔，每 tick 扫描一次
  const emailTick = config.email.dispatcherTickMin;
  cron.schedule(`*/${emailTick} * * * *`, () => {
    processEmailDigests().catch((err) => console.error('[scheduler] 邮件汇总发送失败:', err.message));
  });
  console.log(`[scheduler] 邮件汇总：每 ${emailTick} 分钟扫描一次（各用户按自身间隔发送）`);
}
