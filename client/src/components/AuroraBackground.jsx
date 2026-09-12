import { motion } from 'motion/react';

// 极简“极光”背景：低饱和度的薄荷绿 / 青 / 天蓝光斑缓慢漂移（Aceternity Aurora Background 的轻量版）
// 仅用于页面顶部点缀氛围，pointer-events-none + blur，不影响交互与加载
export default function AuroraBackground({ className = '' }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}
    >
      <motion.div
        className="absolute -top-28 -left-24 h-80 w-80 rounded-full bg-mint-200/40 blur-3xl"
        animate={{ x: [0, 48, 0], y: [0, 28, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -top-16 right-0 h-96 w-96 rounded-full bg-emerald-100/50 blur-3xl"
        animate={{ x: [0, -40, 0], y: [0, 36, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-32 left-1/3 h-72 w-72 rounded-full bg-sky-100/40 blur-3xl"
        animate={{ x: [0, 28, 0], y: [0, -24, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
