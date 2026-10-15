import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';
import { CARD_FACE, FACE_W, PlayingCard, SUIT, cardHeight, isSpecial, suitLabel, suitOf } from '@/components/cards';
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

/**
 * Overlapping cards inside a composited layer each get their own GPU layer; hundreds of them exhaust GPU memory
 * and the browser starts dropping layers, so hovered elements flicker out. At rest each drift group is painted
 * into one canvas instead, and the card elements only show while a page transition moves them.
 */
const DRIFT_GROUPS = 4;
type Group = { p: Placed; i: number }[];
function groupPile(pile: Placed[]) {
  const groups: Group[] = Array.from({ length: DRIFT_GROUPS }, () => []);
  pile.forEach((p, i) => groups[i % DRIFT_GROUPS].push({ p, i }));
  return groups;
}

const SEVEN = typeof Path2D === 'undefined' ? null : new Path2D('M8 6H42L20 60H9L31 16H6Z M10 32H33L30 39H7Z');

/** Draws a label the way CardInside sets it, centred on (x, y); the crossed seven is its SVG path. */
function drawGlyph(ctx: CanvasRenderingContext2D, card: Rush10Card, text: string, size: number, x: number, y: number) {
  if (card.type === 'number' && card.value === 7 && SEVEN) {
    ctx.save();
    ctx.translate(x - 0.32 * size, y - 0.45 * size);
    ctx.scale(0.64 * size / 44, 0.9 * size / 64);
    ctx.fill(SEVEN);
    ctx.restore();
    return;
  }
  ctx.font = `${size}px Bangers, sans-serif`;
  ctx.fillText(text, x, y);
}

function glyphWidth(ctx: CanvasRenderingContext2D, card: Rush10Card, text: string, size: number) {
  if (card.type === 'number' && card.value === 7) return 0.64 * size;
  ctx.font = `${size}px Bangers, sans-serif`;
  return ctx.measureText(text).width;
}

/** A canvas copy of PlayingCard at (0, 0): close enough to swap with the real cards under the blur. */
function drawCard(ctx: CanvasRenderingContext2D, card: Rush10Card, width: number, scale: number) {
  const height = cardHeight(width);
  const suit = suitOf(card, 0);
  const label = card.type === 'wild' ? 'W' : card.type === 'skip' ? 'SKIP' : String(card.value ?? '?');
  let fill: string | CanvasGradient = CARD_FACE;
  if (suit === 'wild') {
    fill = ctx.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, '#8B5CF6');
    fill.addColorStop(1, '#EC4899');
  } else if (suit === 'skip') fill = SUIT.skip;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, width * 0.157);
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14 * scale;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, width * 0.157 - 1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  // Face coordinates: the 79x122 face with its 8px padding, scaled like ScaledFace.
  ctx.translate(2, 2);
  ctx.scale((width - 4) / FACE_W, (width - 4) / FACE_W);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = suitLabel(suit);
  const cornerW = glyphWidth(ctx, card, label, 15);
  drawGlyph(ctx, card, label, 15, 8 + cornerW / 2, 15.5);
  ctx.save();
  ctx.translate(71 - cornerW / 2, 106.5);
  ctx.rotate(Math.PI);
  drawGlyph(ctx, card, label, 15, 0, 0);
  ctx.restore();
  if (isSpecial(suit)) {
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2 * scale;
  }
  drawGlyph(ctx, card, label, card.type === 'skip' ? 29 : 55, 39.5, 61);
  ctx.shadowColor = 'transparent';
}

/** One drift group's cards at rest, painted once (and again on resize) into a single canvas. */
function PileCanvas({ group, cardW }: { group: Group; cardW: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const box = canvas?.parentElement;
    if (!canvas || !box) return;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const w = box.clientWidth, h = box.clientHeight;
      // Device pixels would be wasted under the 9px blur.
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      for (const { p } of group) {
        ctx.save();
        ctx.translate(p.left / 100 * w, p.top / 100 * h);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.scale(p.scale, p.scale);
        ctx.translate(-cardW / 2, -cardHeight(cardW) / 2);
        drawCard(ctx, p.card, cardW, p.scale);
        ctx.restore();
      }
    };
    document.fonts.load('15px Bangers').catch(() => undefined).then(paint);
    const observer = new ResizeObserver(paint);
    observer.observe(box);
    return () => { cancelled = true; observer.disconnect(); };
  }, [group, cardW]);
  return <canvas ref={ref} className="lobby-backdrop-paint" />;
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
  const groups = useMemo(() => groupPile(pile), [pile]);

  return (
    <div className="lobby-backdrop" data-motion={animate ? 'animated' : 'paused'} aria-hidden="true" inert>
      {/* Sits under the pile: hidden at rest, revealed whenever the cards fall away. */}
      <div className="lobby-backdrop-hero brand-wordmark">RUSH 10</div>
      <div className="lobby-backdrop-pile">
        {groups.map((group, g) => {
          // Each group drifts as one layer, steered by its first card's motion with a gentler tilt.
          const lead = group[0].p;
          return (
            <div key={g} className="lobby-backdrop-drift" style={{ '--bd-d': `${lead.dur.toFixed(2)}s`, '--bd-delay': `${lead.delay.toFixed(2)}s`, '--bd-x': `${lead.dx.toFixed(1)}px`, '--bd-y': `${lead.dy.toFixed(1)}px`, '--bd-r': `${(lead.dr * 0.15).toFixed(2)}deg` } as CSSProperties}>
              <PileCanvas group={group} cardW={cardW} />
              {group.map(({ p, i }) => (
                <div key={i} className="lobby-backdrop-slot" style={{
                  left: `${p.left}%`, top: `${p.top}%`, '--bd-base': `translate(-50%,-50%) rotate(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`,
                  '--fall-x': `${p.travel.fallX.toFixed(1)}vw`, '--fall-r': `${p.travel.fallR.toFixed(1)}deg`, '--fall-d': `${p.travel.fallD.toFixed(2)}s`, '--fall-delay': `${p.travel.fallDelay.toFixed(2)}s`,
                  '--in-x': p.travel.inX, '--in-y': p.travel.inY, '--in-y-back': p.travel.inYBack, '--in-r': `${p.travel.inR.toFixed(1)}deg`, '--in-d': `${p.travel.inD.toFixed(2)}s`, '--in-delay': `${p.travel.inDelay.toFixed(2)}s`,
                } as CSSProperties}>
                  <PlayingCard card={p.card} width={cardW} className="lobby-backdrop-card" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="lobby-backdrop-shade" />
    </div>
  );
}

/** Decorative, non-interactive card pile shared by the home page and waiting room. */
export const LobbyCardBackdrop = memo(LobbyCardBackdropInner);
