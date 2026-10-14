import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const COLORS = ['#FFB800', '#FF3366', '#A3E635', '#38BDF8', '#C084FC', '#FDE68A'];
const PIECES = 14;

/** A small sideways confetti spray anchored to its (relative) parent's edge, refiring every `every` ms. */
export function ConfettiBurst({ direction, every = 2000, className = 'top-1/2' }: { direction: 'left' | 'right'; every?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shot, setShot] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setShot(n => n + 1), every);
    return () => window.clearInterval(timer);
  }, [reduce, every]);

  // Re-roll the spread on every shot so each burst looks a little different.
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, i) => {
    const angle = (Math.random() * 70 - 45) * Math.PI / 180; // mostly sideways, biased upward
    const distance = 40 + Math.random() * 70;
    const sign = direction === 'left' ? -1 : 1;
    return {
      id: i,
      color: COLORS[i % COLORS.length],
      dx: sign * Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      fall: 18 + Math.random() * 22,
      spin: (Math.random() * 2 - 1) * 540,
      w: Math.random() < 0.5 ? 6 : 4,
      h: Math.random() < 0.5 ? 3 : 6,
      round: Math.random() < 0.3,
      duration: 0.9 + Math.random() * 0.5,
    };
  }), [shot, direction]);

  if (reduce) return null;
  return <span aria-hidden key={shot} className={`pointer-events-none absolute ${className} ${direction === 'left' ? 'left-0' : 'right-0'} h-0 w-0`} data-testid={`confetti-${direction}`}>
    {pieces.map(p => <motion.span key={p.id}
      className="absolute left-0 top-0 block"
      style={{ width: p.w, height: p.h, background: p.color, borderRadius: p.round ? 9999 : 1 }}
      initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
      animate={{ x: [0, p.dx, p.dx * 1.15], y: [0, p.dy, p.dy + p.fall], opacity: [1, 1, 0], rotate: [0, p.spin * 0.7, p.spin], scale: [0.6, 1, 1] }}
      transition={{ duration: p.duration, ease: 'easeOut', times: [0, 0.6, 1] }} />)}
  </span>;
}
