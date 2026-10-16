import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownUp, Palette } from 'lucide-react';
import type { Rush10Card } from '@workspace/api-client-react';
import { ScaledFace, cardHeight, cardLabel } from '@/components/cards';
import { DealFlight, type DealDestination, type DealOrigin } from '@/components/deal-flight';

/** Keep only present cards, preserving the player's order and appending new draws. */
export function reconcileOrder(order: string[], cards: Rush10Card[]) {
  const present = new Set(cards.map(card => card.id));
  const kept = [...new Set(order)].filter(id => present.has(id));
  const known = new Set(kept);
  return [...kept, ...cards.filter(card => !known.has(card.id)).map(card => card.id)];
}

export function moveCard(order: string[], id: string, target: string) {
  if (id === target || !order.includes(id) || !order.includes(target)) return order;
  const next = order.filter(candidate => candidate !== id);
  next.splice(order.indexOf(target), 0, id);
  return next;
}

export function sortHand(cards: Rush10Card[]) {
  const rank = { number: 0, wild: 1, skip: 2 };
  return [...cards].sort((a, b) =>
    rank[a.type] - rank[b.type] ||
    (a.value ?? 0) - (b.value ?? 0) ||
    (a.color ?? '').localeCompare(b.color ?? '')
  ).map(card => card.id);
}

const COLOR_ORDER: Record<string, number> = { red: 0, blue: 1, green: 2, yellow: 3 };

/** Secondary sort: grouped by color, then number. Wild and Skip cards last. */
export function sortHandByColor(cards: Rush10Card[]) {
  const rank = { number: 0, wild: 1, skip: 2 };
  return [...cards].sort((a, b) =>
    rank[a.type] - rank[b.type] ||
    (COLOR_ORDER[a.color ?? ''] ?? 9) - (COLOR_ORDER[b.color ?? ''] ?? 9) ||
    (a.value ?? 0) - (b.value ?? 0)
  ).map(card => card.id);
}

function moveToIndex(order: string[], id: string, index: number) {
  const from = order.indexOf(id);
  if (from < 0 || from === index) return order;
  const next = order.filter(candidate => candidate !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

const ACTIVATION_PX = 6;
const EDGE_PAD = 18;
const EASE = [0.22, 1, 0.36, 1] as const;

/** On-screen rect of the dragged card where it was released. */
export type DropRect = { left: number; top: number; width: number; height: number };

/** A successful draw: the new card id and the on-screen rect of the pile it came from. */
export type IncomingDraw = { id: string; from: { left: number; top: number; width: number; height: number }; nonce: number };

type Drag = {
  id: string;
  pointerId: number;
  startX: number; startY: number;
  offsetX: number; offsetY: number;
  x: number; y: number;
  active: boolean;
  /** Order snapshot taken at pointerdown, used to revert on Escape/cancel. */
  origin: string[];
  target: HTMLElement;
};

type Flight = { id: string; nonce: number; from: IncomingDraw['from']; to: { left: number; top: number; rotation: number } };

/** Fan geometry derived from the available width and card count. */
function useFan(width: number, n: number, height: number) {
  const normalWidth = width < 520 ? 72 : width < 900 ? 90 : Math.min(200, Math.round(width / 9.5));
  const cw = Math.min(normalWidth, height <= 650 ? 78 : height <= 750 ? 90 : height <= 850 ? 100 : 200);
  const ch = cardHeight(cw);
  const maxAngle = n > 1 ? Math.min(15, 3 + n * 1.05) : 0;
  // Reserve the rotated top corners and selection zoom, not just flat card widths.
  const edgePad = Math.ceil(ch * Math.sin(maxAngle * Math.PI / 180) + cw * .065 + 12);
  const fit = n > 1 ? (width - edgePad * 2 - cw) / (n - 1) : 0;
  const step = n > 1 ? Math.max(0, Math.min(cw * .74, fit)) : 0;
  const total = cw + step * Math.max(0, n - 1);
  const padLeft = Math.max(edgePad, (width - total) / 2);
  const spread = Math.max(16, cw * 0.86 - step);
  const sag = n > 1 ? Math.min(30, 6 + n * 2.1) : 0;
  // Reserve room for a selected card's lift and zoom (bottom-anchored) so selecting never shifts the
  // layout or covers the row above. The Discard button above a selected card may still rise over it.
  const topRoom = Math.ceil(30 + ch * .13) + 8;
  return { cw, ch, step, padLeft, spread, maxAngle, sag, edgePad, topRoom };
}

export function OrderedHand({ cards, storageKey, selected, toggleCard, color, incoming, renderAction, headerExtra, controlsSlot, deal, dealDelay = 0, onDealingChange, onDragCardChange, onDropCards, hiddenIds, locked = false }: {
  onDragCardChange?: (id: string | null) => void;
  onDropCards?: (id: string, x: number, y: number, rect: DropRect) => boolean;
  /** Cards still in hand but drawn elsewhere (e.g. parked where they were dropped). */
  hiddenIds?: string[];
  locked?: boolean;
  cards: Rush10Card[];
  storageKey: string;
  selected: string[];
  toggleCard: (id: string) => void;
  color: (card: Rush10Card, index: number) => string;
  incoming?: IncomingDraw | null;
  /** Contextual control shown above the single focused card (e.g. Discard). */
  renderAction?: (card: Rush10Card) => ReactNode;
  headerExtra?: ReactNode;
  /** Render the sort controls into this element instead of a row above the cards; null while it mounts. */
  controlsSlot?: HTMLElement | null;
  deal?: { id: string; createdAt: number };
  /** Seconds before the first dealt card leaves the pile. */
  dealDelay?: number;
  onDealingChange?: (dealing: boolean) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const [announce, setAnnounce] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  const reduceMotion = useReducedMotion();
  const [dealing, setDealing] = useState(() => {
    if (!deal || Date.now() - deal.createdAt > 8000 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    try { return sessionStorage.getItem(`${storageKey}:dealt`) !== deal.id; } catch { return true; }
  });
  const [dealTargets, setDealTargets] = useState<DealDestination[]>([]);
  const [dealOrigin, setDealOrigin] = useState<DealOrigin | null>(null);
  const [dealMeasureTick, setDealMeasureTick] = useState(0);
  const [landed, setLanded] = useState<string[]>([]);
  useLayoutEffect(() => {
    onDealingChange?.(dealing);
    return () => onDealingChange?.(false);
  }, [dealing, onDealingChange]);
  useEffect(() => {
    if (dealing && dealTargets.length > 0 && dealTargets.every(target => landed.includes(target.id))) setDealing(false);
  }, [dealing, dealTargets, landed]);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const handledNonce = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    // Fan spacing includes padding; observing the content width feeds that
    // padding back into the next layout and can continuously restart flights.
    const observer = new ResizeObserver(() => { if (el.clientWidth) setWidth(el.clientWidth); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ids = reconcileOrder(order, cards);
  const shown = liveOrder ? reconcileOrder(liveOrder, cards) : ids;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const fan = useFan(width, shown.length, viewportHeight);
  const fanRef = useRef(fan);
  fanRef.current = fan;
  const fingerprint = JSON.stringify(ids);
  useLayoutEffect(() => {
    if (!dealing) return;
    if (dealTargets.length) return;
    if (reduceMotion) { setDealing(false); return; }
    const container = containerRef.current;
    if (!container || width !== container.clientWidth) return;
    const pile = document.querySelector('[data-pile="deck"]');
    if (!pile) {
      // Next-round results exit before the draw pile mounts.
      const retry = window.setTimeout(() => setDealMeasureTick(tick => tick + 1), 50);
      return () => window.clearTimeout(retry);
    }
    const rect = pile.getBoundingClientRect();
    setDealOrigin(previous => previous ?? { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    const handRect = container.getBoundingClientRect();
    const targets = shown.map((id, index) => {
      const t = shown.length > 1 ? index / (shown.length - 1) * 2 - 1 : 0;
      return { id, x: handRect.left + fan.padLeft + index * fan.step - container.scrollLeft, y: handRect.top + fan.topRoom + t * t * fan.sag, rotation: t * fan.maxAngle, delay: dealDelay + index * .2 };
    });
    setDealTargets(targets);
    try { if (deal) sessionStorage.setItem(`${storageKey}:dealt`, deal.id); } catch { /* Animation still works without storage. */ }
    return undefined;
  }, [dealing, width, fingerprint, reduceMotion, dealTargets.length, dealMeasureTick]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, fingerprint); } catch { /* Keep in-memory order. */ }
    setOrder(previous => JSON.stringify(previous) === fingerprint ? previous : JSON.parse(fingerprint));
  }, [fingerprint, storageKey]);

  // Draw flight: only runs for a success-driven incoming draw, once per nonce.
  const incomingPresent = !!incoming && cards.some(card => card.id === incoming.id);
  useLayoutEffect(() => {
    if (!incoming || handledNonce.current === incoming.nonce || !incomingPresent) return;
    handledNonce.current = incoming.nonce;
    const container = containerRef.current;
    const slot = slotRefs.current.get(incoming.id);
    if (!container || !slot) return;
    if (reduceMotion) return;
    // Slot rects can contain an in-progress layout transform. Aim at the final
    // untransformed fan position instead, including its arc and bottom pivot.
    const rect = container.getBoundingClientRect();
    const index = shown.indexOf(incoming.id);
    const t = shown.length > 1 ? index / (shown.length - 1) * 2 - 1 : 0;
    setHovered(null);
    setFlight({ id: incoming.id, nonce: incoming.nonce, from: incoming.from, to: {
      left: rect.left + fan.padLeft + index * fan.step,
      top: rect.top + fan.topRoom + t * t * fan.sag,
      rotation: t * fan.maxAngle,
    } });
  }, [incoming, incomingPresent, reduceMotion]);
  useEffect(() => { if (flight && !cards.some(card => card.id === flight.id)) setFlight(null); }, [cards, flight]);

  function endDrag(commit: boolean) {
    const current = dragRef.current;
    if (!current) return;
    if (current.active) {
      suppressClick.current = true;
      const { cw, ch } = fanRef.current;
      const played = commit && onDropCards?.(current.id, current.x, current.y, { left: current.x - current.offsetX, top: current.y - current.offsetY, width: cw, height: ch });
      if (commit && !played) setOrder(reconcileOrder(shownRef.current, cardsRef.current));
      else setOrder(reconcileOrder(current.origin, cardsRef.current));
      setTimeout(() => { suppressClick.current = false; }, 0);
    } else if (commit) {
      toggleCard(current.id);
    }
    dragRef.current = null;
    onDragCardChange?.(null);
    try { if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId); } catch { /* ignore */ }
    setDrag(null);
    setLiveOrder(null);
  }

  const draggedPresent = !drag || cards.some(card => card.id === drag.id);
  useEffect(() => { if (!draggedPresent) endDrag(false); });

  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); endDrag(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Insertion index from untransformed layout offsets (arc/spread are transforms), corrected for scroll. */
  function insertionIndex(clientX: number, id: string) {
    const container = containerRef.current;
    if (!container) return -1;
    const { step, cw } = fanRef.current;
    const px = clientX - container.getBoundingClientRect().left + container.scrollLeft;
    let best = -1; let bestScore = Infinity;
    shownRef.current.forEach((candidate, index) => {
      const el = slotRefs.current.get(candidate);
      if (!el) return;
      const visible = index === shownRef.current.length - 1 ? cw : step;
      const score = Math.abs(px - (el.offsetLeft + visible / 2));
      if (score < bestScore) { bestScore = score; best = index; }
    });
    if (best < 0) return best;
    return shownRef.current[best] === id ? shownRef.current.indexOf(id) : best;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next: Drag = {
      id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      offsetX: Math.min(fanRef.current.cw, Math.max(0, event.clientX - rect.left)),
      offsetY: Math.min(fanRef.current.ch, Math.max(0, event.clientY - rect.top)),
      x: event.clientX, y: event.clientY,
      active: false, origin: shownRef.current, target: containerRef.current ?? event.currentTarget,
    };
    dragRef.current = next;
    try { next.target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < ACTIVATION_PX) return;
      current.active = true;
      onDragCardChange?.(current.id);
      setHovered(null);
      try { current.target.setPointerCapture(current.pointerId); } catch { /* ignore */ }
      setLiveOrder(shownRef.current);
    }
    event.preventDefault();
    current.x = event.clientX; current.y = event.clientY;
    setDrag({ ...current });
    const index = insertionIndex(event.clientX, current.id);
    if (index >= 0) setLiveOrder(previous => {
      const base = reconcileOrder(previous ?? shownRef.current, cardsRef.current);
      const moved = moveToIndex(base, current.id, index);
      return moved === base ? previous : moved;
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, id: string, label: string) {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const index = ids.indexOf(id);
    const target = event.key === 'ArrowLeft' ? index - 1 : index + 1;
    if (target < 0 || target >= ids.length) return;
    setOrder(moveToIndex(ids, id, target));
    setAnnounce(`${label} moved to position ${target + 1} of ${ids.length}`);
  }

  const { cw, ch, step, padLeft, spread, maxAngle, sag, topRoom } = fan;
  const radius = cw * 0.157;
  const spring = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.7 };
  const draggedCard = drag?.active ? cards.find(card => card.id === drag.id) : undefined;
  const focusId = selected.length === 1 ? selected[0] : null;
  const spreadIndices = drag?.active || flight ? [] : [...new Set([hovered, focusId])]
    .filter((id): id is string => !!id && shown.includes(id))
    .map(id => shown.indexOf(id));
  const flightCard = flight ? cards.find(card => card.id === flight.id) : undefined;
  const n = shown.length;

  const controls = <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {headerExtra}
        {!locked && <div className="sort-split" role="group" aria-label="Sort my hand">
          <button type="button" data-testid="button-sort-hand" disabled={dealing || !!drag || cards.length < 2}
            onClick={() => {
              if (dragRef.current) return;
              setOrder(sortHand(shown.map(id => cards.find(card => card.id === id)!)));
              setAnnounce('Hand sorted by number, then color. Wild and Skip cards are last.');
            }}
            title="Sort by number, then color; Wild and Skip cards last"
            className="sort-split-main"><ArrowDownUp size={13} /> Sort my hand</button>
          <button type="button" data-testid="button-sort-hand-color" disabled={dealing || !!drag || cards.length < 2}
            onClick={() => {
              if (dragRef.current) return;
              setOrder(sortHandByColor(shown.map(id => cards.find(card => card.id === id)!)));
              setAnnounce('Hand sorted by color, then number. Wild and Skip cards are last.');
            }}
            title="Sort by color, then number" aria-label="Sort by color"
            className="sort-split-alt"><Palette size={13} /> <span>By color</span></button>
        </div>}
      </div>;

  return <>
    {controlsSlot !== undefined
      ? controlsSlot && createPortal(controls, controlsSlot)
      : /* Above the cards so raised cards can slide under the buttons; only the buttons take clicks. */
        <div className="pointer-events-none relative z-[70] flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-4 md:px-8">{controls}</div>}
    <p className="sr-only" aria-live="polite">{announce}</p>
    <div ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={event => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current.x = event.clientX;
          dragRef.current.y = event.clientY;
          endDrag(true);
        }
      }}
      onPointerCancel={event => { if (dragRef.current?.pointerId === event.pointerId) endDrag(false); }}
      onLostPointerCapture={event => { if (event.target === event.currentTarget && dragRef.current?.pointerId === event.pointerId) endDrag(false); }}
      onPointerLeave={() => setHovered(null)}
      className="hand-row relative flex w-full flex-nowrap overflow-x-clip overflow-y-visible"
      style={{ paddingLeft: padLeft, paddingTop: topRoom, paddingBottom: sag + 22 }}
      data-testid="ordered-hand">
      {shown.map((id, index) => {
        const card = cards.find(candidate => candidate.id === id)!;
        const label = cardLabel(card);
        const lifted = drag?.active && drag.id === id;
        const isSelected = selected.includes(id);
        const isFocus = focusId === id;
        const isHover = hovered === id && !drag?.active;
        const desiredShift = spreadIndices.reduce((sum, s) => sum + (index < s ? -spread / 2 : index > s ? spread / 2 : 0), 0);
        const slotLeft = padLeft + index * step;
        const shift = Math.max(fan.edgePad - slotLeft, Math.min(width - fan.edgePad - cw - slotLeft, desiredShift));
        const t = n > 1 ? (index / (n - 1)) * 2 - 1 : 0;
        const rot = t * maxAngle;
        const arcY = t * t * sag;
        const inFlight = flight?.id === id || (dealing && !landed.includes(id));
        const raised = isFocus || isHover;
        return <motion.div key={id} layout="position" transition={spring}
          ref={(el: HTMLDivElement | null) => { if (el) slotRefs.current.set(id, el); else slotRefs.current.delete(id); }}
          onPointerEnter={event => { if (!dealing && !flight && event.pointerType === 'mouse' && !dragRef.current?.active) setHovered(id); }}
          animate={{ x: shift }}
          className="relative shrink-0"
          style={{ width: cw, height: ch, marginRight: index === n - 1 ? 0 : step - cw, zIndex: isFocus ? 60 : isHover ? 50 : isSelected ? 20 + index : index + 1 }}>
          {lifted && <div aria-hidden className="absolute inset-0 border-2 border-dashed border-[#A3E635]/60 bg-[#0F172A]/50" style={{ borderRadius: radius, transform: `translateY(${arcY}px) rotate(${rot}deg)` }} data-testid="hand-drop-placeholder" />}
          <motion.button type="button"
            disabled={dealing || locked}
            onPointerDown={event => onPointerDown(event, id)}
            onKeyDown={event => onKeyDown(event, id, label)}
            onClick={event => { if (event.detail !== 0 || suppressClick.current) return; toggleCard(id); }}
            onDragStart={event => event.preventDefault()}
            onFocus={() => slotRefs.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
            initial={false}
            animate={{
              y: arcY + (isSelected ? -30 : isHover ? -18 : 0),
              rotate: raised ? rot * 0.35 : isSelected ? rot * 0.6 : rot,
              scale: isFocus ? 1.13 : isSelected ? 1.09 : isHover ? 1.05 : 1,
            }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 30, mass: 0.6 }}
            aria-label={`${label}, position ${index + 1} of ${n}`} aria-pressed={isSelected}
            aria-describedby="hand-reorder-hint"
            data-testid={`card-in-hand-${id}`}
            className={`hand-card relative block touch-none select-none overflow-hidden border-2 border-[#CBD5E1] outline-none focus-visible:ring-[3px] focus-visible:ring-[#FFB800] ${isSelected ? 'is-selected' : ''} ${raised ? 'is-raised' : ''} ${lifted || inFlight || hiddenIds?.includes(id) ? 'opacity-0' : ''}`}
            style={{ width: cw, height: ch, borderRadius: radius, background: color(card, index), transformOrigin: '50% 100%' }}>
            <ScaledFace card={card} innerWidth={cw - 4} />
          </motion.button>
          {(isFocus || (isHover && isSelected)) && !drag?.active && !inFlight && !hiddenIds?.includes(id) && renderAction && <motion.div key={`action-${id}`}
            style={{ x: '-50%', top: arcY - 30 - 50 }} initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: EASE }}
            className="absolute left-1/2 z-[70] whitespace-nowrap" data-keep-selection>
            {renderAction(card)}
          </motion.div>}
        </motion.div>;
      })}
      <div aria-hidden className="shrink-0" style={{ width: EDGE_PAD }} />
    </div>
    <span id="hand-reorder-hint" className="sr-only">Press Alt plus Left or Right arrow to move this card.</span>
    {dealing && dealOrigin && dealTargets.filter(target => !landed.includes(target.id)).map(target => {
      const card = cards.find(card => card.id === target.id);
      return card && <DealFlight key={target.id} card={card} destination={target} origin={dealOrigin}
        width={cw} height={ch} background={color(card, shown.indexOf(card.id))}
        onLand={() => setLanded(previous => {
          const next = previous.includes(target.id) ? previous : [...previous, target.id];
          return next;
        })} />;
    })}
    {flight && flightCard && <DealFlight key={flight.nonce} card={flightCard}
      destination={{ id: flight.id, x: flight.to.left, y: flight.to.top, rotation: flight.to.rotation, delay: 0 }}
      origin={{ x: flight.from.left, y: flight.from.top, width: flight.from.width, height: flight.from.height }}
      width={cw} height={ch} background={color(flightCard, shown.indexOf(flightCard.id))}
      onLand={() => setFlight(current => current?.nonce === flight.nonce ? null : current)} />}
    {draggedCard && drag && createPortal(
      <div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100]"
        style={{ transform: `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)` }}>
        <div className={`relative overflow-hidden border-2 border-[#CBD5E1] shadow-[0_26px_44px_rgba(0,0,0,.55)] ${reduceMotion ? '' : 'rotate-[-5deg] scale-[1.08]'} ${selected.includes(draggedCard.id) ? 'outline outline-[3px] outline-offset-2 outline-[#A3E635]' : ''}`}
          style={{ width: cw, height: ch, borderRadius: radius, background: color(draggedCard, shown.indexOf(draggedCard.id)) }}>
          <ScaledFace card={draggedCard} innerWidth={cw - 4} />
        </div>
      </div>, document.body)}
  </>;
}
