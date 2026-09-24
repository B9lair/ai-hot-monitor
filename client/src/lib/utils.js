import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// 合并 Tailwind 类名（Aceternity 风格）：支持条件类与冲突覆盖
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ===== 抓取间隔（分钟）与「数值 + 单位」互转 =====
// 后端仅存分钟数（intervalMin），前端用分钟/小时/天三种单位展示与输入。

/** 分钟 → 可读字符串（60 → "1 小时"，1440 → "1 天"，90 → "90 分钟"） */
export function formatInterval(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return '1 小时';
  if (m % 1440 === 0) return `${m / 1440} 天`;
  if (m % 60 === 0) return `${m / 60} 小时`;
  return `${m} 分钟`;
}

/** 分钟 → { value, unit }，用于编辑回填（优先匹配最大单位） */
export function splitInterval(min) {
  const m = Number(min);
  if (m >= 1440 && m % 1440 === 0) return { value: m / 1440, unit: 'day' };
  if (m >= 60 && m % 60 === 0) return { value: m / 60, unit: 'hour' };
  return { value: Math.max(1, Math.round(m) || 1), unit: 'minute' };
}

/** { value, unit } → 分钟 */
export function toMinutes(value, unit) {
  const v = Math.max(1, Math.round(Number(value) || 1));
  if (unit === 'day') return v * 1440;
  if (unit === 'hour') return v * 60;
  return v;
}
