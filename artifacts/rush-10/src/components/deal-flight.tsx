import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';
import { ScaledFace } from '@/components/cards';

export type DealDestination = { id: string; x: number; y: number; rotation: number; delay: number };
export type DealOrigin = { x: number; y: number; width: number; height: number };

const DURATION = 620;
const FADE_IN = 90;
const EASING = 'cubic-bezier(.22,1,.36,1)';

/**
 * Same size, bottom-center origin, shadow and final rotation as the real hand card.
 * Handoff: `onLand` when the flight arrives; the parent reveals the hand card and passes `landed`.
 * The flight then drops its own shadow (the hand card's takes over beneath it) and stays on top
 * for two more frames so the newly shown card has painted before `onDone` removes the flight.
 */
export function DealFlight({ card, destination, origin, width, height, background, landed = false, onLand, onDone }: {
  card: Rush10Card; destination: DealDestination; origin: DealOrigin;
  width: number; height: number; background: string; landed?: boolean; onLand: () => void; onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const landRef = useRef(onLand);
  landRef.current = onLand;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const x = origin.x + (origin.width - width) / 2;
  const y = origin.y + origin.height - height;
  const finalTransform = `translate(${destination.x}px, ${destination.y}px) rotate(${destination.rotation}deg) scale(1)`;
  useLayoutEffect(() => {
    const el = ref.current;
    const lift = liftRef.current;
    if (!el || !lift) return;
    const delay = destination.delay * 1000;
    const total = delay + DURATION;
    const timing = { delay, duration: DURATION, fill: 'both' as const };
    const move = el.animate([
      { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(${origin.width / width})` },
      { transform: finalTransform },
    ], { ...timing, easing: EASING });
    // Runs from mount rather than after the delay, so the hidden card is already rastered when it appears.
    const fade = el.animate([
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: delay / total },
      { opacity: 1, offset: (delay + FADE_IN) / total },
      { opacity: 1, offset: 1 },
    ], { duration: total, fill: 'forwards' });
    // Extra depth while airborne, settling to the resting hand shadow on arrival.
    const rise = lift.animate([{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 0 }], { ...timing, easing: 'ease-in-out' });
    let cancelled = false;
    move.finished.then(() => { if (!cancelled) landRef.current(); }).catch(() => {});
    return () => { cancelled = true; move.cancel(); fade.cancel(); rise.cancel(); };
  }, [x, y, origin.width, width, finalTransform, destination.delay]);
  useLayoutEffect(() => {
    if (!landed) return;
    // Same commit as the hand card's reveal: its shadow replaces this one with no double-dark frame.
    if (bodyRef.current) bodyRef.current.style.boxShadow = 'none';
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => doneRef.current()); });
    return () => cancelAnimationFrame(frame);
  }, [landed]);
  const radius = width * .157;
  return createPortal(<div className="pointer-events-none fixed inset-0 z-[110] overflow-hidden"><div ref={ref}
    aria-hidden data-testid={`deal-flight-${card.id}`}
    className="pointer-events-none absolute left-0 top-0 z-[110] will-change-transform"
    style={{ width, height, transformOrigin: '50% 100%', transform: finalTransform, opacity: 0 }}>
    <div ref={liftRef} className="deal-flight-lift absolute inset-0" style={{ borderRadius: radius, opacity: 0 }} />
    <div ref={bodyRef} className="deal-flight-card absolute inset-0 overflow-hidden border-2 border-[#CBD5E1]" style={{ borderRadius: radius, background }}>
      <ScaledFace card={card} innerWidth={width - 4} />
    </div>
  </div></div>, document.body);
}
