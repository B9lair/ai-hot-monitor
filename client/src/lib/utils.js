import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// 合并 Tailwind 类名（Aceternity 风格）：支持条件类与冲突覆盖
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
