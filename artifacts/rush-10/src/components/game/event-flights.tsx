import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import type { Rush10GameEvent, Rush10RoomView } from '@workspace/api-client-react';
import { CardBack, PlayingCard } from '@/components/cards';

const STALE_MS = 8000;
const SPRITE_W = 60;
const SEAT_SCALE = 0.55;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Consumes unseen public table events. The first event list seen is hydration (never animated);
 * stale entries and the local player's own draws (already animated by the hand) are skipped.
 */
export function useTableEvents(room: Rush10RoomView | undefined, selfId: string | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Rush10GameEvent[]>([]);
  const reduceMotion = useReducedMotion();
  const events = room?.events;
  const signature = events?.map(event => event.id).join('|') ?? '';

  useEffect(() => {
    if (!events) return;
    if (seen.current === null) { seen.current = new Set(events.map(event => event.id)); return; }
    const known = seen.current;
    const fresh = events.filter(event => !known.has(event.id));
    if (!fresh.length) return;
    fresh.forEach(event => known.add(event.id));
    if (known.size > 400) seen.current = new Set(events.map(event => event.id));
    if (reduceMotion) return;
    const now = Date.now();
    const play = fresh
      .filter(event => now - event.createdAt <= STALE_MS)
      .filter(event => event.kind !== 'deal')
      .filter(event => !(event.playerId === selfId && (event.kind === 'draw-deck' || event.kind === 'draw-discard')))
      .sort((a, b) => a.createdAt - b.createdAt);
    if (play.length) setQueue(previous => [...previous, ...play].slice(-14));
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Include newly received events before the effect queues them, so the pile
  // cannot flash its new top card for one render before the flight starts.
  const freshPending = seen.current && !reduceMotion
    ? (events ?? []).filter(event => !seen.current!.has(event.id) && Date.now() - event.createdAt <= STALE_MS)
    : [];
  return {
    current: queue[0] ?? null,
    pendingDiscards: [...queue, ...freshPending].filter(event => event.kind === 'discard'),
    advance: () => setQueue(previous => previous.slice(1)),
  };
}

type Box = { x: number; y: number; w: number };

function boxOf(selector: string): Box | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}

function handSelector(playerId: string, selfId?: string) {
  return playerId === selfId ? '[data-self-hand]' : `[data-seat-hand="${playerId}"]`;
}

function route(event: Rush10GameEvent, selfId?: string): { from: Box | null; to: Box | null; fromScale: number; toScale: number } {
  const hand = boxOf(handSelector(event.playerId, selfId));
  const isSelf = event.playerId === selfId;
  const handScale = isSelf ? 1.2 : SEAT_SCALE;
  const pileScale = (box: Box | null) => box ? Math.min(1.8, box.w / SPRITE_W) : 1;
  switch (event.kind) {
    case 'draw-deck': { const deck = boxOf('[data-pile="deck"]'); return { from: deck, to: hand, fromScale: pileScale(deck), toScale: handScale }; }
    case 'draw-discard': { const pile = boxOf('[data-pile="discard"]'); return { from: pile, to: hand, fromScale: pileScale(pile), toScale: handScale }; }
    case 'discard': { const pile = boxOf('[data-pile="discard"]'); return { from: hand, to: pile, fromScale: handScale, toScale: pileScale(pile) }; }
    case 'hit': {
      const target = (event.card && boxOf(`[data-meld-card="${event.card.id}"]`)) || boxOf(`[data-meld-zone="${event.playerId}"]`);
      return { from: hand, to: target, fromScale: handScale, toScale: target ? Math.min(1.2, target.w / SPRITE_W) : 0.8 };
    }
    case 'lay-phase': return { from: hand, to: boxOf(`[data-meld-zone="${event.playerId}"]`), fromScale: handScale, toScale: 0.8 };
    default: return { from: null, to: null, fromScale: 1, toScale: 1 };
  }
}

function Sprite({ event, selfId, onDone }: { event: Rush10GameEvent; selfId?: string; onDone: () => void }) {
  const [path, setPath] = useState<ReturnType<typeof route> | null>(null);
  const fired = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(() => { if (fired.current) return; fired.current = true; onDoneRef.current(); });

  useLayoutEffect(() => {
    const next = route(event, selfId);
    if (!next.from || !next.to) { doneRef.current(); return; }
    setPath(next);
    const safety = window.setTimeout(() => doneRef.current(), 1600);
    return () => window.clearTimeout(safety);
  }, [event, selfId]);

  if (!path?.from || !path.to) return null;
  const { from, to, fromScale, toScale } = path;
  const h = SPRITE_W * 1.52;
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - 70;
  const isLay = event.kind === 'lay-phase';
  const faceUp = !!event.card && (event.kind === 'discard' || event.kind === 'hit');
  const toward = to.x > from.x ? 1 : -1;

  return createPortal(
    <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[120]"
      style={{ width: SPRITE_W, height: h }}
      initial={{ x: from.x - SPRITE_W / 2, y: from.y - h / 2, scale: fromScale, rotate: -10 * toward, opacity: 0.4 }}
      animate={{
        x: [from.x - SPRITE_W / 2, midX - SPRITE_W / 2, to.x - SPRITE_W / 2],
        y: [from.y - h / 2, midY - h / 2, to.y - h / 2],
        scale: [fromScale, Math.max(fromScale, toScale) * 1.12, toScale],
        rotate: [-10 * toward, 8 * toward, 0],
        opacity: [0.4, 1, 1],
      }}
      transition={{ duration: isLay ? 0.8 : 0.66, ease: EASE, times: [0, 0.48, 1] }}
      onAnimationComplete={() => doneRef.current()}>
      {isLay ? <div className="relative h-full w-full">
        {[-14, 0, 14].map((r, i) => <CardBack key={i} width={SPRITE_W} className="absolute left-0 top-0 shadow-[0_14px_30px_rgba(0,0,0,.5)]" style={{ transform: `translateX(${(i - 1) * 16}px) rotate(${r}deg)`, transformOrigin: '50% 100%' }} />)}
      </div> : faceUp && event.card
        ? <PlayingCard card={event.card} width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />
        : <CardBack width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />}
    </motion.div>,
    document.body,
  );
}

/** Plays queued table events one after another so bursts of moves never get lost. */
export function EventFlights({ current, advance, selfId }: { current: Rush10GameEvent | null; advance: () => void; selfId?: string }) {
  if (!current) return null;
  return <Sprite key={current.id} event={current} selfId={selfId} onDone={advance} />;
}
