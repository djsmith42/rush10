import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';
import { CARD_FACE, FACE_W, SUIT, cardHeight, isSpecial, suitLabel, suitOf } from '@/components/cards';
import { usePageTransition, type Entrance, type TransitionDirection, type TransitionPhase } from '@/lib/page-transition';
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
 * Hundreds of overlapping card elements would each need their own GPU layer while they move; that exhausts GPU
 * memory and the browser drops layers, so cards flicker out. Instead each drift group is one canvas that draws
 * its cards from pre-rendered sprites, at rest and through page transitions alike, so nothing is ever swapped.
 */
const DRIFT_GROUPS = 4;
type Group = Placed[];
function groupPile(pile: Placed[]) {
  const groups: Group[] = Array.from({ length: DRIFT_GROUPS }, () => []);
  pile.forEach((p, i) => groups[i % DRIFT_GROUPS].push(p));
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

/** The old box-shadow (0 14px 30px); padding covers its blur (two sigmas) on each side and its drop below. */
const SHADOW = { color: 'rgba(0,0,0,.45)', blur: 30, y: 14, pad: 30, padBottom: 44 };

/** PlayingCard's face, border and lettering at (0, 0), in CSS pixels. */
function drawFace(ctx: CanvasRenderingContext2D, card: Rush10Card, width: number, res: number) {
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
  ctx.fillStyle = fill;
  ctx.fill();
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
    // Canvas shadows ignore the transform, so they are sized in sprite pixels.
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 4 * res;
    ctx.shadowOffsetY = 2 * res;
  }
  drawGlyph(ctx, card, label, card.type === 'skip' ? 29 : 55, 39.5, 61);
  ctx.shadowColor = 'transparent';
}

type Sprites = { width: number; res: number; faces: Map<string, HTMLCanvasElement> };
const cardKey = (card: Rush10Card) => card.type === 'number' ? `${card.color}-${card.value}` : card.type;
let sprites: Sprites | null = null;
let spriteUsers = 0;

function spriteCanvas(width: number, height: number, res: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * res);
  canvas.height = Math.ceil(height * res);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);
  return { canvas, ctx };
}

/** One sprite per distinct card, shadow included so each card is a single draw; kept while any backdrop is mounted. */
function spritesFor(pile: Placed[], width: number, res: number) {
  if (!sprites || sprites.width !== width || sprites.res !== res) sprites = { width, res, faces: new Map() };
  const height = cardHeight(width);
  for (const { card } of pile) {
    const key = cardKey(card);
    if (sprites.faces.has(key)) continue;
    const { canvas, ctx } = spriteCanvas(width + SHADOW.pad * 2, height + SHADOW.pad + SHADOW.padBottom, res);
    ctx.translate(SHADOW.pad, SHADOW.pad);
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, width * 0.157);
    ctx.shadowColor = SHADOW.color;
    ctx.shadowBlur = SHADOW.blur * res;
    ctx.shadowOffsetY = SHADOW.y * res;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    drawFace(ctx, card, width, res);
    sprites.faces.set(key, canvas);
  }
  return sprites;
}

/** CSS cubic-bezier timing, solved for x then sampled for y. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) {
      const value = at(x1, x2, t);
      if (Math.abs(value - x) < 1e-5) break;
      if (value < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return at(y1, y2, t);
  };
}
const FALL_EASE = bezier(.5, 0, .9, .4);
const ENTER_EASE = bezier(.16, .84, .3, 1);

type Motion = { phase: TransitionPhase; direction: TransitionDirection; entrance: Entrance; elapsed: number; vw: number; vh: number };

/**
 * Where a card sits mid-transition, as the old CSS keyframes placed it: screen-space translate and rotate about
 * the card's slot centre, prepended to its resting translate(-50%,-50%) rotate scale. Returns whether it is still moving.
 */
function travel(p: Placed, motion: Motion | null, out: { dx: number; dy: number; r: number }) {
  out.dx = 0; out.dy = 0; out.r = 0;
  if (!motion) return false;
  const { travel: t, top } = p;
  if (motion.phase === 'fall') {
    const progress = (motion.elapsed - t.fallDelay) / t.fallD;
    const e = FALL_EASE(progress);
    out.dx = t.fallX * motion.vw * e;
    out.dy = (motion.direction === 'back' ? -150 : 150) * motion.vh * e;
    out.r = t.fallR * e;
    return progress < 1;
  }
  if (motion.phase === 'enter') {
    const slow = motion.entrance.slowdown;
    const progress = (motion.elapsed - motion.entrance.holdMs / 1000 - t.inDelay * slow) / (t.inD * slow);
    const away = 1 - ENTER_EASE(progress);
    out.dx = parseFloat(t.inX) * motion.vw * away;
    out.dy = (motion.direction === 'back' ? 145 - top : -(top + 45)) * motion.vh * away;
    out.r = t.inR * away;
    return progress < 1;
  }
  return false;
}

const DEG = Math.PI / 180;
const offset = { dx: 0, dy: 0, r: 0 };
/** What each canvas last showed at rest, so phase changes that leave the pile still don't repaint it under the blur. */
const stillPainted = new WeakMap<HTMLCanvasElement, string>();

/** Paints one drift group at the given moment; returns whether any of its cards is still moving. */
function paintGroup(canvas: HTMLCanvasElement, group: Group, cardW: number, art: Sprites, res: number, motion: Motion | null) {
  const box = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  if (!box || !ctx) return false;
  const w = box.clientWidth, h = box.clientHeight;
  const pw = Math.round(w * res), ph = Math.round(h * res);
  const still = `${pw}x${ph}:${cardW}:${art.res}:${group.length}`;
  if (!motion && stillPainted.get(canvas) === still) return false;
  if (motion) stillPainted.delete(canvas); else stillPainted.set(canvas, still);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  // Sprites are drawn near their own size, where bilinear is as good as the costlier filters.
  ctx.imageSmoothingQuality = 'low';
  const ch = cardHeight(cardW);
  const reach = (Math.hypot(cardW, ch) * 1.3) / 2 + SHADOW.padBottom;
  const spriteW = cardW + SHADOW.pad * 2, spriteH = ch + SHADOW.pad + SHADOW.padBottom;
  let moving = false;
  for (const p of group) {
    const face = art.faces.get(cardKey(p.card));
    if (!face) continue;
    moving = travel(p, motion, offset) || moving;
    // The motion rotates about the slot centre, which sits half a card down-right of the card's centre.
    const cos = Math.cos(offset.r * DEG), sin = Math.sin(offset.r * DEG);
    const x = p.left / 100 * w + cardW / 2 + offset.dx - (cos * cardW - sin * ch) / 2;
    const y = p.top / 100 * h + ch / 2 + offset.dy - (sin * cardW + cos * ch) / 2;
    if (x < -reach || y < -reach || x > w + reach || y > h + reach) continue;
    const angle = (offset.r + p.rot) * DEG;
    const a = Math.cos(angle) * p.scale * res, b = Math.sin(angle) * p.scale * res;
    ctx.setTransform(a, b, -b, a, x * res, y * res);
    ctx.drawImage(face, -cardW / 2 - SHADOW.pad, -ch / 2 - SHADOW.pad, spriteW, spriteH);
  }
  return moving;
}

function gridFor(width: number) {
  if (width < 520) return { cols: 4, rows: 7, cardW: 110 };
  if (width < 1024) return { cols: 6, rows: 6, cardW: 135 };
  return { cols: 9, rows: 6, cardW: Math.max(150, Math.ceil(width / 9)) };
}

function LobbyCardBackdropInner() {
  const animate = useBackgroundMotion();
  const { phase, direction, entrance } = usePageTransition();
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
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [fontsReady, setFontsReady] = useState(() => document.fonts.check('15px Bangers'));
  useEffect(() => {
    if (fontsReady) return;
    let cancelled = false;
    document.fonts.load('15px Bangers').catch(() => undefined).then(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, [fontsReady]);
  useEffect(() => {
    spriteUsers++;
    // Deferred: a page swap unmounts one backdrop in the same commit that mounts the next.
    return () => { spriteUsers--; window.setTimeout(() => { if (!spriteUsers) sprites = null; }, 0); };
  }, []);

  // Layout effect: the first frame of every phase is already painted for it, at rest and mid-flight alike.
  useLayoutEffect(() => {
    if (!fontsReady) return;
    const moves = animate && (phase === 'fall' || phase === 'enter');
    // Sharp cards need device pixels; at rest the blur hides them, so the canvases stay at CSS size.
    const res = animate && phase !== 'idle' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const art = spritesFor(pile, cardW, Math.min(2, window.devicePixelRatio || 1));
    const start = performance.now();
    let frame = 0;
    const paint = (now: number) => {
      const motion: Motion | null = moves ? { phase, direction, entrance, elapsed: (now - start) / 1000, vw: window.innerWidth / 100, vh: window.innerHeight / 100 } : null;
      let moving = false;
      groups.forEach((group, g) => {
        const canvas = canvases.current[g];
        if (canvas) moving = paintGroup(canvas, group, cardW, art, res, motion) || moving;
      });
      if (moving) frame = requestAnimationFrame(paint);
    };
    paint(start);
    const observer = new ResizeObserver(() => { if (!moves) paint(performance.now()); });
    canvases.current.forEach(canvas => canvas?.parentElement && observer.observe(canvas.parentElement));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [fontsReady, animate, phase, direction, entrance, pile, groups, cardW]);

  return (
    <div className="lobby-backdrop" data-motion={animate ? 'animated' : 'paused'} aria-hidden="true" inert>
      {/* Sits under the pile: hidden at rest, revealed whenever the cards fall away. */}
      <div className="lobby-backdrop-hero brand-wordmark">RUSH 10</div>
      <div className="lobby-backdrop-pile">
        {groups.map((group, g) => {
          // Each group drifts as one layer, steered by its first card's motion with a gentler tilt.
          const lead = group[0];
          return (
            <div key={g} className="lobby-backdrop-drift" style={{ '--bd-d': `${lead.dur.toFixed(2)}s`, '--bd-delay': `${lead.delay.toFixed(2)}s`, '--bd-x': `${lead.dx.toFixed(1)}px`, '--bd-y': `${lead.dy.toFixed(1)}px`, '--bd-r': `${(lead.dr * 0.15).toFixed(2)}deg` } as CSSProperties}>
              <canvas ref={el => { canvases.current[g] = el; }} className="lobby-backdrop-paint" />
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
