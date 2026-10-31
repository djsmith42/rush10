import type { Page } from '@playwright/test';

/** Card-like things that move on screen, and how to name each one in a finding. */
const TRACKED = [
  ['[data-testid^="card-in-hand-"]', 'hand'],
  ['[data-testid^="deal-flight-"]', 'deal-flight'],
  ['body > div.fixed.z-\\[120\\]', 'flight'],
  ['body > div.fixed.z-\\[100\\]', 'drag'],
  ['.pile-top', 'pile'],
  ['[data-meld-card]', 'laid'],
  ['[data-seat-hand] > span', 'seat-card'],
] as const;

type Sample = { id: string; kind: string; x: number; y: number; w: number; h: number; opacity: number; shadow: number; sig: string };
type Frame = { t: number; items: Sample[] };
export type MotionTrace = { frames: Frame[]; loaf: Array<{ start: number; blocking: number; duration: number }>; viewport: { w: number; h: number } };

/** Start sampling every tracked element on every animation frame. */
export async function startMotion(page: Page) {
  await page.evaluate((tracked) => {
    type W = Window & { __motion?: { frames: unknown[]; loaf: unknown[]; stop: boolean } };
    const w = window as W;
    const ids = new WeakMap<Element, string>();
    let next = 0;
    const idOf = (el: Element, kind: string) => {
      let id = ids.get(el);
      if (!id) {
        const key = el.getAttribute('data-testid') ?? el.getAttribute('data-meld-card');
        id = key ? `${kind}:${key.replace(/^(card-in-hand-|deal-flight-)/, '')}` : `${kind}#${++next}`;
        ids.set(el, id);
      }
      return id;
    };
    const opacityOf = (el: Element) => {
      let o = 1;
      for (let node: Element | null = el; node && node !== document.body && o > 0.01; node = node.parentElement) {
        const style = getComputedStyle(node);
        o *= Number(style.opacity);
        if (style.visibility === 'hidden' || style.display === 'none') return 0;
      }
      return o;
    };
    // Shadow weight: how dark and spread out each blurred shadow is, for the element and two levels inside it.
    const shadowOf = (el: Element) => {
      let total = 0;
      const nodes = [el, ...Array.from(el.children), ...Array.from(el.children).flatMap(c => Array.from(c.children))];
      for (const node of nodes) {
        const style = getComputedStyle(node);
        const own = node === el ? 1 : Number(style.opacity);
        for (const value of [style.boxShadow, style.filter]) {
          if (!value || value === 'none') continue;
          for (const m of value.matchAll(/rgba?\(([^)]+)\)\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)) {
            const alpha = Number(m[1].split(',')[3] ?? 1);
            total += own * alpha * (Number(m[4]) + Math.abs(Number(m[3])));
          }
        }
      }
      return Math.round(total * 10) / 10;
    };
    const motion = { frames: [] as unknown[], loaf: [] as unknown[], stop: false };
    w.__motion = motion;
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { blockingDuration?: number }>) {
          motion.loaf.push({ start: entry.startTime, blocking: entry.blockingDuration ?? 0, duration: entry.duration });
        }
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch { /* Not supported: no blocking data. */ }
    const tick = (t: number) => {
      if (motion.stop) return;
      const items: unknown[] = [];
      for (const [selector, kind] of tracked) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
          const opacity = opacityOf(el);
          const face = (el.textContent ?? '').replace(/\s+/g, '');
          // Same number, different color is a different card: include the ink of the first lettering.
          const ink = face && !face.includes('RUSH') && opacity > 0.05
            ? Array.from(el.querySelectorAll('*')).find(node => Array.from(node.childNodes).some(c => c.nodeType === 3 && c.textContent!.trim()))
            : undefined;
          items.push({ id: idOf(el, kind), kind, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
            opacity: Math.round(opacity * 100) / 100, shadow: opacity > 0.05 ? shadowOf(el) : 0, sig: face.includes('RUSH') || !ink ? '' : `${face}/${getComputedStyle(ink).color}` });
        }
      }
      motion.frames.push({ t, items });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, TRACKED as unknown as Array<[string, string]>);
}

export async function stopMotion(page: Page): Promise<MotionTrace> {
  return page.evaluate(() => {
    const motion = (window as unknown as { __motion: { frames: Frame[]; loaf: MotionTrace['loaf']; stop: boolean } }).__motion;
    motion.stop = true;
    return { frames: motion.frames, loaf: motion.loaf, viewport: { w: innerWidth, h: innerHeight } };
  });
}

export type MotionIssue = { at: number; what: string };
export type MotionReport = {
  frames: number; seconds: number; p95FrameMs: number; maxFrameMs: number; longFrames: number; maxBlockingMs: number;
  teleports: MotionIssue[]; popIns: MotionIssue[]; vanishes: MotionIssue[]; shadowPops: MotionIssue[]; duplicates: MotionIssue[];
  stalls: MotionIssue[];
};

// Frames up to this long (or about twice the run's typical frame) are judged; longer ones are stalls.
const NORMAL_FRAME_MS = 45;
// A jump: a single frame that covers this much ground, and far more than the frames either side of it.
// Easing speeds up and slows down gradually; a teleport is a spike.
const TELEPORT_MIN_PX = 48;
const TELEPORT_PX_PER_MS = 3;
const TELEPORT_SPIKE = 2;
const SHADOW_POP = 12;
// A gap this long while cards are moving is a visible hitch. Gaps while nothing moves (a screen swap) are not.
// Shared CI-class machines drop to ~15–20fps under load, so only real hitches count.
const STALL_MS = Number(process.env.E2E_STALL_MS ?? 200);

/** Find cards that jump, appear or vanish in one frame, shadows that snap on, and doubled cards. */
export function analyzeMotion(trace: MotionTrace): MotionReport {
  const { frames } = trace;
  const t0 = frames[0]?.t ?? 0;
  const at = (t: number) => Math.round(t - t0);
  const issues = { teleports: [] as MotionIssue[], popIns: [] as MotionIssue[], vanishes: [] as MotionIssue[], shadowPops: [] as MotionIssue[], duplicates: [] as MotionIssue[], stalls: [] as MotionIssue[] };
  const visible = (s?: Sample) => !!s && s.opacity > 0.6;
  const hidden = (s?: Sample) => !s || s.opacity < 0.05;
  // Something card-sized was already showing there: a handoff (a flight landing, a card revealed under it), not a pop.
  const coveredBy = (items: Sample[], s: Sample) => items.some(o => o.id !== s.id && o.opacity > 0.3
    && Math.hypot(o.x - s.x, o.y - s.y) < Math.max(28, 0.45 * Math.max(s.w, s.h))
    && o.w > s.w * 0.4 && o.w < s.w * 2.5);
  const label = (s: Sample) => `${s.id}${s.sig ? ` (${s.sig.slice(0, 12)})` : ''}`;
  // How far each element moved into frame i.
  const steps = frames.map((frame, i) => {
    const before = new Map((frames[i - 1]?.items ?? []).map(s => [s.id, s]));
    return new Map(frame.items.flatMap(s => { const p = before.get(s.id); return p ? [[s.id, Math.hypot(s.x - p.x, s.y - p.y)] as const] : []; }));
  });
  // A frame well over the run's typical frame is the machine stalling, not the page moving.
  const typical = [...frames.slice(1).map((f, i) => f.t - frames[i].t)].sort((a, b) => a - b)[Math.floor((frames.length - 1) / 2)] ?? 16;
  const slowFrame = Math.max(NORMAL_FRAME_MS, typical * 2.2);
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1], cur = frames[i];
    const dt = cur.t - prev.t;
    dts.push(dt);
    if (dt > STALL_MS && i > 1) {
      const earlier = new Map(frames[i - 2].items.map(s => [s.id, s]));
      const moving = prev.items.filter(s => { const e = earlier.get(s.id); return !!e && s.opacity > 0.3 && Math.hypot(s.x - e.x, s.y - e.y) > 1; });
      if (moving.length) issues.stalls.push({ at: at(cur.t), what: `frame took ${Math.round(dt)}ms while ${moving.length} card${moving.length === 1 ? ' was' : 's were'} moving (${moving.slice(0, 3).map(s => s.id).join(', ')})` });
    }
    // Time-based animations catch up after a stall; don't read that catch-up as a jump.
    if (dt > slowFrame || (i > 1 && prev.t - frames[i - 2].t > slowFrame)) continue;
    const before = new Map(prev.items.map(s => [s.id, s]));
    const after = new Map(cur.items.map(s => [s.id, s]));
    for (const s of cur.items) {
      const p = before.get(s.id);
      // The drag ghost follows the pointer by design; judge the cards, not the mouse.
      if (visible(p) && visible(s) && s.kind !== 'drag') {
        const d = Math.hypot(s.x - p!.x, s.y - p!.y);
        const around = Math.max(steps[i - 1]?.get(s.id) ?? 0, steps[i + 1]?.get(s.id) ?? 0);
        if (d > TELEPORT_MIN_PX && d / dt > TELEPORT_PX_PER_MS && d > TELEPORT_SPIKE * around) {
          issues.teleports.push({ at: at(cur.t), what: `${label(s)} jumped ${Math.round(d)}px in ${Math.round(dt)}ms (${Math.round(p!.x)},${Math.round(p!.y)} → ${Math.round(s.x)},${Math.round(s.y)})` });
        }
        if (s.shadow - p!.shadow > SHADOW_POP && p!.shadow < s.shadow * 0.4) {
          issues.shadowPops.push({ at: at(cur.t), what: `${label(s)} shadow snapped from ${p!.shadow} to ${s.shadow}` });
        }
      }
      if (hidden(p) && visible(s) && !coveredBy(prev.items, s) && !coveredBy(cur.items, s)) {
        issues.popIns.push({ at: at(cur.t), what: `${label(s)} appeared at full opacity at ${Math.round(s.x)},${Math.round(s.y)}` });
      }
    }
    for (const p of prev.items) {
      const s = after.get(p.id);
      if (visible(p) && hidden(s) && !coveredBy(cur.items, p) && !coveredBy(prev.items, p)) {
        issues.vanishes.push({ at: at(cur.t), what: `${label(p)} vanished at ${Math.round(p.x)},${Math.round(p.y)}` });
      }
    }
    // A face still in the air must not already be showing where it is going.
    // Deal flights never head for a pile, and the deck holds two of every card, so only table flights count.
    for (const f of cur.items.filter(s => s.kind === 'flight' && s.sig && visible(s))) {
      for (const o of cur.items) {
        if (o.kind !== 'pile' && o.kind !== 'laid') continue;
        if (o.sig === f.sig && visible(o) && Math.hypot(o.x - f.x, o.y - f.y) > 40) {
          issues.duplicates.push({ at: at(cur.t), what: `${label(f)} is in flight while ${label(o)} already shows it` });
        }
      }
    }
  }
  const sorted = [...dts].sort((a, b) => a - b);
  // Report each problem once per element, at its first frame.
  const firstPerId = (list: MotionIssue[]) => {
    const seen = new Set<string>();
    return list.filter(issue => { const key = issue.what.split(' ')[0]; if (seen.has(key)) return false; seen.add(key); return true; });
  };
  return {
    frames: frames.length,
    seconds: Math.round((frames.at(-1)?.t ?? t0) - t0) / 1000,
    p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    maxFrameMs: Math.round(sorted.at(-1) ?? 0),
    longFrames: dts.filter(dt => dt > 50).length,
    maxBlockingMs: Math.round(Math.max(0, ...trace.loaf.map(l => l.blocking))),
    teleports: firstPerId(issues.teleports), popIns: firstPerId(issues.popIns), vanishes: firstPerId(issues.vanishes),
    shadowPops: firstPerId(issues.shadowPops), duplicates: firstPerId(issues.duplicates), stalls: issues.stalls,
  };
}
