import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';
import { PlayingCard } from '@/components/cards';
import { useBackgroundMotion } from './use-background-motion';

/** Deterministic PRNG so the pile never reshuffles between renders/polls. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['red', 'blue', 'green', 'yellow'] as const;

type Placed = { card: Rush10Card; left: number; top: number; rot: number; scale: number; dur: number; delay: number; dx: number; dy: number; dr: number };

function buildPile(cols: number, rows: number): Placed[] {
  const rand = mulberry32(1010);
  const out: Placed[] = [];
  // Jittered grid (plus overscan ring) guarantees every edge is covered.
  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      for (let k = 0; k < 4; k++) {
        const roll = rand();
        const card: Rush10Card = roll < 0.07
          ? ({ type: 'wild' } as Rush10Card)
          : roll < 0.12
            ? ({ type: 'skip' } as Rush10Card)
            : ({ type: 'number', color: COLORS[Math.floor(rand() * 4)], value: 1 + Math.floor(rand() * 12) } as Rush10Card);
        out.push({
          card,
          left: ((c + 0.5 + (rand() - 0.5) * 1.1) / cols) * 100,
          top: ((r + 0.5 + (rand() - 0.5) * 1.1) / rows) * 100,
          rot: (rand() - 0.5) * 80,
          scale: 0.9 + rand() * 0.4,
          dur: 9 + rand() * 9,
          delay: -rand() * 18,
          dx: 8 + rand() * 16,
          dy: 6 + rand() * 14,
          dr: 2 + rand() * 4,
        });
      }
    }
  }
  // Shuffle stacking order deterministically.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function gridFor(width: number) {
  if (width < 520) return { cols: 4, rows: 7, cardW: 110 };
  if (width < 1024) return { cols: 6, rows: 6, cardW: 135 };
  return { cols: 9, rows: 6, cardW: Math.max(150, Math.ceil(width / 9)) };
}

function LobbyCardBackdropInner() {
  const animate = useBackgroundMotion();
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setWidth(window.innerWidth)); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, []);
  const { cols, rows, cardW } = gridFor(width);
  const pile = useMemo(() => buildPile(cols, rows), [cols, rows]);

  return (
    <div className="lobby-backdrop" data-motion={animate ? 'animated' : 'paused'} aria-hidden="true" inert>
      <div className="lobby-backdrop-pile">
        {pile.map((p, i) => (
          <div key={i} className="lobby-backdrop-slot" style={{ left: `${p.left}%`, top: `${p.top}%`, transform: `translate(-50%,-50%) rotate(${p.rot}deg) scale(${p.scale})` } as CSSProperties}>
            <div className="lobby-backdrop-drift" style={{ '--bd-d': `${p.dur.toFixed(2)}s`, '--bd-delay': `${p.delay.toFixed(2)}s`, '--bd-x': `${p.dx.toFixed(1)}px`, '--bd-y': `${p.dy.toFixed(1)}px`, '--bd-r': `${p.dr.toFixed(1)}deg` } as CSSProperties}>
              <PlayingCard card={p.card} width={cardW} className="lobby-backdrop-card" />
            </div>
          </div>
        ))}
      </div>
      <div className="lobby-backdrop-shade" />
    </div>
  );
}

/** Decorative, non-interactive card pile shared by the home page and waiting room. */
export const LobbyCardBackdrop = memo(LobbyCardBackdropInner);
