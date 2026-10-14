import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';
import { ScaledFace } from '@/components/cards';

export type DealDestination = { id: string; x: number; y: number; rotation: number; delay: number };
export type DealOrigin = { x: number; y: number; width: number; height: number };

/** Same size, bottom-center origin and final rotation as the real hand card. */
export function DealFlight({ card, destination, origin, width, height, background, onLand }: {
  card: Rush10Card; destination: DealDestination; origin: DealOrigin;
  width: number; height: number; background: string; onLand: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const landRef = useRef(onLand);
  landRef.current = onLand;
  const x = origin.x + (origin.width - width) / 2;
  const y = origin.y + origin.height - height;
  const finalTransform = `translate(${destination.x}px, ${destination.y}px) rotate(${destination.rotation}deg) scale(1)`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const animation = el.animate([
      { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(${origin.width / width})`, opacity: 1 },
      { transform: finalTransform, opacity: 1 },
    ], { duration: 620, delay: destination.delay * 1000, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    let cancelled = false;
    animation.finished.then(() => { if (!cancelled) landRef.current(); }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [x, y, origin.width, width, finalTransform, destination.delay]);
  return createPortal(<div className="pointer-events-none fixed inset-0 z-[110] overflow-hidden"><div ref={ref}
    aria-hidden data-testid={`deal-flight-${card.id}`}
    className="pointer-events-none absolute left-0 top-0 z-[110] overflow-hidden border-2 border-[#CBD5E1]"
    style={{ width, height, borderRadius: width * .157, background, transformOrigin: '50% 100%', transform: finalTransform, opacity: 0 }}>
    <ScaledFace card={card} innerWidth={width - 4} />
  </div></div>, document.body);
}
