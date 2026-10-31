import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import type { Rush10Card, Rush10GameEvent, Rush10RoomView } from '@workspace/api-client-react';
import { CardBack, PlayingCard } from '@/components/cards';

const STALE_MS = 8000;
const SPRITE_W = 60;
const SEAT_SCALE = 0.55;
// Flights leave from rest and settle softly. A curve that starts at full speed (the old [.22, 1, .36, 1] began at 4.5× the average)
// turns the first late frame after a flight mounts into a visible jump off the starting spot.
const FLIGHT_EASE = [0.45, 0, 0.2, 1] as const;

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
    pending: [...queue, ...freshPending],
    pendingDiscards: [...queue, ...freshPending].filter(event => event.kind === 'discard'),
    advance: () => setQueue(previous => previous.slice(1)),
  };
}

type Box = { x: number; y: number; w: number };

/** A card the local player played (dropped, discarded or added to a pile), or the stack they laid down, held where
 *  it left the hand until its flight plays. That covers the frame between the server's reply and the flight starting. */
export type ParkedPose = { card: Rush10Card; x: number; y: number; width: number; rotate: number };
export type ParkedDrop = ParkedPose & { kind: 'discard' | 'hit' | 'lay-phase'; hidden?: string[]; cards?: ParkedPose[] };

/** Whether this event is the flight for the parked card. */
export function isParkedEvent(event: Rush10GameEvent, parked: ParkedDrop, selfId?: string) {
  return event.kind === parked.kind && event.playerId === selfId && (event.kind === 'lay-phase' || event.card?.id === parked.card.id);
}

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

type Route = { from: Box | null; to: Box | null; fromScale: number; toScale: number; dropped?: { rotate: number; toRotate: number } };

function route(event: Rush10GameEvent, selfId?: string, parked?: ParkedDrop | null): Route {
  const hand = boxOf(handSelector(event.playerId, selfId));
  const drop = parked && isParkedEvent(event, parked, selfId) ? parked : null;
  const dropBox = drop && { x: drop.x, y: drop.y, w: drop.width };
  const isSelf = event.playerId === selfId;
  const handScale = isSelf ? 1.2 : SEAT_SCALE;
  const pileScale = (box: Box | null) => box ? Math.min(1.8, box.w / SPRITE_W) : 1;
  switch (event.kind) {
    case 'draw-deck': { const deck = boxOf('[data-pile="deck"]'); return { from: deck, to: hand, fromScale: pileScale(deck), toScale: handScale }; }
    case 'draw-discard': { const pile = boxOf('[data-pile="discard"]'); return { from: pile, to: hand, fromScale: pileScale(pile), toScale: handScale }; }
    case 'discard': {
      const pile = boxOf('[data-pile="discard"]');
      if (drop) return { from: dropBox, to: pile, fromScale: drop.width / SPRITE_W, toScale: pileScale(pile), dropped: { rotate: drop.rotate, toRotate: 3 } };
      return { from: hand, to: pile, fromScale: handScale, toScale: pileScale(pile) };
    }
    case 'hit': {
      const target = (event.card && boxOf(`[data-meld-card="${event.card.id}"]`)) || boxOf(`[data-meld-zone="${event.playerId}"]`);
      const toScale = target ? Math.min(1.2, target.w / SPRITE_W) : 0.8;
      if (drop) return { from: dropBox, to: target, fromScale: drop.width / SPRITE_W, toScale, dropped: { rotate: drop.rotate, toRotate: 0 } };
      return { from: hand, to: target, fromScale: handScale, toScale };
    }
    case 'lay-phase': {
      const zone = boxOf(`[data-meld-zone="${event.playerId}"]`);
      if (drop) return { from: dropBox, to: zone, fromScale: drop.width / SPRITE_W, toScale: 0.8, dropped: { rotate: drop.rotate, toRotate: 0 } };
      return { from: hand, to: zone, fromScale: handScale, toScale: 0.8 };
    }
    default: return { from: null, to: null, fromScale: 1, toScale: 1 };
  }
}

function Sprite({ event, selfId, parked, onDone }: { event: Rush10GameEvent; selfId?: string; parked?: ParkedDrop | null; onDone: () => void }) {
  const [path, setPath] = useState<Route | null>(null);
  const fired = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(() => { if (fired.current) return; fired.current = true; onDoneRef.current(); });

  useLayoutEffect(() => {
    const next = route(event, selfId, parked);
    if (!next.from || !next.to) { doneRef.current(); return; }
    setPath(next);
    const safety = window.setTimeout(() => doneRef.current(), 1600);
    return () => window.clearTimeout(safety);
  }, [event, selfId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!path?.from || !path.to) return parked ? <ParkedCard parked={parked} /> : null;
  if (event.kind === 'lay-phase' && parked?.cards?.length) return <LaidCardsFlight cards={parked.cards} to={path.to} onDone={() => doneRef.current()} />;
  const { from, to, fromScale, toScale, dropped } = path;
  // A dropped card is already in the player's grip: start from its exact pose instead of fading in from the hand.
  const h = SPRITE_W * 1.52;
  const midY = Math.min(from.y, to.y) - 70;
  const isLay = event.kind === 'lay-phase';
  const faceUp = !!event.card && (event.kind === 'discard' || event.kind === 'hit');
  const toward = to.x > from.x ? 1 : -1;
  const startRotate = dropped ? dropped.rotate : -10 * toward;
  const startOpacity = dropped ? 1 : 0.4;

  return createPortal(
    <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[120]"
      style={{ width: SPRITE_W, height: h }}
      initial={{ x: from.x - SPRITE_W / 2, y: from.y - h / 2, scale: fromScale, rotate: startRotate, opacity: startOpacity }}
      animate={dropped ? {
        x: [from.x - SPRITE_W / 2, to.x - SPRITE_W / 2],
        y: [from.y - h / 2, to.y - h / 2],
        scale: [fromScale, toScale],
        rotate: [startRotate, dropped.toRotate],
        // A laid stack melts into the piles flipping in under it rather than blinking out.
        opacity: isLay ? [1, 1, 0] : 1,
      } : {
        x: [from.x - SPRITE_W / 2, to.x - SPRITE_W / 2],
        y: [from.y - h / 2, midY - h / 2, to.y - h / 2],
        scale: [fromScale, Math.max(fromScale, toScale) * 1.12, toScale],
        rotate: [startRotate, 8 * toward, 0],
        opacity: isLay ? [startOpacity, 1, 1, 0] : [startOpacity, 1, 1],
      }}
      // One ease across the whole sideways move, and an arc that eases into and out of its top, so the card's speed
      // never jumps: a fast-starting ease on each half made it stall at the top and then lurch.
      transition={dropped
        ? { duration: isLay ? 0.6 : 0.42, ease: FLIGHT_EASE, ...(isLay ? { opacity: { duration: 0.6, times: [0, 0.7, 1] } } : {}) }
        : (() => {
          const duration = isLay ? 0.8 : 0.66;
          const arc = { duration, times: [0, 0.48, 1], ease: ['easeInOut', 'easeInOut'] as const };
          return { duration, x: { duration, ease: FLIGHT_EASE }, y: arc, scale: arc, rotate: arc,
            opacity: isLay ? { duration, times: [0, 0.3, 0.75, 1] } : { duration, times: [0, 0.3, 1] } };
        })()}
      onAnimationComplete={() => doneRef.current()}>
      {isLay ? <LaidStack /> : faceUp && event.card
        ? <PlayingCard card={event.card} width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />
        : <CardBack width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />}
    </motion.div>,
    document.body,
  );
}

/** Three fanned backs: a level on its way to the table. */
function LaidStack() {
  return <div className="relative h-full w-full">
    {[-14, 0, 14].map((r, i) => <CardBack key={i} width={SPRITE_W} className="absolute left-0 top-0 shadow-[0_14px_30px_rgba(0,0,0,.5)]" style={{ transform: `translateX(${(i - 1) * 16}px) rotate(${r}deg)`, transformOrigin: '50% 100%' }} />)}
  </div>;
}

/** Your own level: each laid card leaves its place in the hand and lands on its own place in the new piles,
 *  which stay empty until it arrives. */
function LaidCardsFlight({ cards, to, onDone }: { cards: ParkedPose[]; to: Box; onDone: () => void }) {
  const h = SPRITE_W * 1.52;
  const [targets] = useState(() => cards.map(pose => boxOf(`[data-meld-card="${pose.card.id}"]`) ?? to));
  return createPortal(<>{cards.map((pose, i) => {
    const target = targets[i];
    const scale = target === to ? 0.8 : target.w / SPRITE_W;
    return <motion.div key={pose.card.id} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[120]"
      style={{ width: SPRITE_W, height: h }}
      initial={{ x: pose.x - SPRITE_W / 2, y: pose.y - h / 2, rotate: pose.rotate, scale: pose.width / SPRITE_W }}
      animate={{ x: target.x - SPRITE_W / 2, y: target.y - h / 2, rotate: 0, scale }}
      transition={{ duration: 0.6, delay: i * 0.03, ease: FLIGHT_EASE }}
      onAnimationComplete={i === cards.length - 1 ? onDone : undefined}>
      <PlayingCard card={pose.card} width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />
    </motion.div>;
  })}</>, document.body);
}

function ParkedCard({ parked }: { parked: ParkedDrop }) {
  const h = SPRITE_W * 1.52;
  if (parked.cards?.length) return createPortal(<>{parked.cards.map(pose => <div key={pose.card.id} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[120]"
    style={{ width: SPRITE_W, height: h, transform: `translate(${pose.x - SPRITE_W / 2}px, ${pose.y - h / 2}px) rotate(${pose.rotate}deg) scale(${pose.width / SPRITE_W})` }}>
    <PlayingCard card={pose.card} width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />
  </div>)}</>, document.body);
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[120]"
      style={{ width: SPRITE_W, height: h, transform: `translate(${parked.x - SPRITE_W / 2}px, ${parked.y - h / 2}px) rotate(${parked.rotate}deg) scale(${parked.width / SPRITE_W})` }}>
      <PlayingCard card={parked.card} width={SPRITE_W} className="shadow-[0_18px_36px_rgba(0,0,0,.55)]" />
    </div>,
    document.body,
  );
}

/** Plays queued table events one after another so bursts of moves never get lost. */
export function EventFlights({ current, advance, selfId, parked }: { current: Rush10GameEvent | null; advance: () => void; selfId?: string; parked?: ParkedDrop | null }) {
  // The parked card waits in place while earlier queued flights play, then becomes its own flight.
  const flying = !!current && !!parked && isParkedEvent(current, parked, selfId);
  return <>
    {current && <Sprite key={current.id} event={current} selfId={selfId} parked={flying ? parked : null} onDone={advance} />}
    {parked && !flying && <ParkedCard parked={parked} />}
  </>;
}
