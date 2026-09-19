import cron from 'node-cron';
import { config } from './config.js';
import { runAllMonitors } from './services/monitor.js';
import { sendDailyDigest, flushPendingEmails } from './services/email.js';
import { broadcastNotification } from './socket.js';

/**
 * 初始化定时任务
 * 1. 关键词监控：默认每 30 分钟（MONITOR_INTERVAL_MIN）
 * 2. 暂缓邮件补发：每分钟检查（免打扰结束 / 配额释放后自动补发）
 * 3. 每日汇总邮件：EMAIL_MODE=daily 时按 EMAIL_DAILY_AT 发送
 */
export function initScheduler() {
  const monitorMin = config.intervals.monitorMin;

  // 关键词监控
  cron.schedule(`*/${monitorMin} * * * *`, async () => {
    console.log('[scheduler] 执行关键词监控...');
    const results = await runAllMonitors();
    for (const r of results) {
      if (r.alerted > 0) {
        // 通用刷新触发（不含标题，前端不计未读）
        broadcastNotification({ type: 'monitor_result', data: { keyword: r.keyword, alerted: r.alerted } });
      }
    }
  });

  console.log(`[scheduler] 已启动：监控每 ${monitorMin} 分钟`);

  // 暂缓邮件补发（免打扰时段结束 / 每小时配额释放后自动补发）
  cron.schedule('* * * * *', () => {
    flushPendingEmails().catch((err) => console.error('[scheduler] 补发暂缓邮件失败:', err.message));
  });

  // 每日汇总邮件
  if (config.email.mode === 'daily') {
    const [hh, mm] = String(config.email.dailyAt).split(':').map((s) => parseInt(s, 10));
    const h = Number.isFinite(hh) ? hh % 24 : 9;
    const m = Number.isFinite(mm) ? mm % 60 : 0;
    cron.schedule(`${m} ${h} * * *`, async () => {
      console.log('[scheduler] 发送每日热点汇总邮件...');
      try {
        await sendDailyDigest();
      } catch (err) {
        console.error('[scheduler] 每日汇总发送失败:', err.message);
      }
    });
    console.log(`[scheduler] 每日汇总邮件：每天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}
