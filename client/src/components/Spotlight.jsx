import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils.js';

// 极简卡片聚光灯：鼠标悬停时浮现柔和薄荷绿光晕（Aceternity Card Spotlight 的轻量版）
// 仅 transform/opacity 合成，无重排，不影响性能
export default function Spotlight({
  children,
  className,
  spotColor = 'rgba(55, 166, 120, 0.10)',
}) {
  const ref = useRef(null);
  const [spot, setSpot] = useState({ x: 0, y: 0, active: false });

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setSpot((s) => ({ ...s, x: e.clientX - r.left, y: e.clientY - r.top }));
      }}
      onMouseEnter={() => setSpot((s) => ({ ...s, active: true }))}
      onMouseLeave={() => setSpot((s) => ({ ...s, active: false }))}
      className={cn('relative overflow-hidden', className)}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-px z-0"
        initial={false}
        animate={{ opacity: spot.active ? 1 : 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{
          background: `radial-gradient(320px circle at ${spot.x}px ${spot.y}px, ${spotColor}, transparent 70%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
