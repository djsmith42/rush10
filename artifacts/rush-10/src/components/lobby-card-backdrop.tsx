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

/** Page-transition motion: how a card falls away, and where it flies in from. */
type Travel = { fallX: number; fallR: number; fallD: number; fallDelay: number; inX: string; inY: string; inYBack: string; inR: number; inD: number; inDelay: number };
type Placed = { card: Rush10Card; left: number; top: number; rot: number; scale: number; dur: number; delay: number; dx: number; dy: number; dr: number; travel: Travel };

function buildPile(cols: number, rows: number): Placed[] {
  const rand = mulberry32(1010);
  const out: Omit<Placed, 'travel'>[] = [];
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
  // A separate seed keeps the resting layout identical to before transitions existed.
  const fly = mulberry32(2020);
  return out.map(p => {
    // Cards enter from above (or from below when going back), the way the old pile left.
    return { ...p, travel: {
      fallX: (fly() - 0.5) * 16,
      fallR: (fly() - 0.5) * 80,
      fallD: 0.55 + fly() * 0.15,
      fallDelay: fly() * 0.18,
      inX: `${((fly() - 0.5) * 30).toFixed(1)}vw`,
      inY: `${(-(p.top + 45)).toFixed(1)}vh`,
      inYBack: `${(145 - p.top).toFixed(1)}vh`,
      inR: (fly() - 0.5) * 120,
      inD: 0.55 + fly() * 0.1,
      inDelay: fly() * 0.2,
    } };
  });
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
      {/* Sits under the pile: hidden at rest, revealed whenever the cards fall away. */}
      <div className="lobby-backdrop-hero card-lettering">RUSH 10</div>
      <div className="lobby-backdrop-pile">
        {pile.map((p, i) => (
          <div key={i} className="lobby-backdrop-slot" style={{
            left: `${p.left}%`, top: `${p.top}%`, '--bd-base': `translate(-50%,-50%) rotate(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`,
            '--fall-x': `${p.travel.fallX.toFixed(1)}vw`, '--fall-r': `${p.travel.fallR.toFixed(1)}deg`, '--fall-d': `${p.travel.fallD.toFixed(2)}s`, '--fall-delay': `${p.travel.fallDelay.toFixed(2)}s`,
            '--in-x': p.travel.inX, '--in-y': p.travel.inY, '--in-y-back': p.travel.inYBack, '--in-r': `${p.travel.inR.toFixed(1)}deg`, '--in-d': `${p.travel.inD.toFixed(2)}s`, '--in-delay': `${p.travel.inDelay.toFixed(2)}s`,
          } as CSSProperties}>
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
