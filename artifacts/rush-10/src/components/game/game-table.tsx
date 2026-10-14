import { multiHitTarget } from '@/lib/hit-target';
import React, { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Rush10Card, Rush10Meld, Rush10PlayerAction, Rush10RoomView, Rush10Rules } from '@workspace/api-client-react';
import { ArrowDown, ArrowRight, CircleHelp, Crown, ListOrdered, LoaderCircle, Trophy, X } from 'lucide-react';
import { PHASE_PARTS, recognizeSelection } from '@/lib/meld-recognition';
import { OrderedHand, type DropRect, type IncomingDraw } from '@/components/ordered-hand';
import { CardBack, PlayingCard, cardColor, cardLabel } from '@/components/cards';
import { AnimalAvatar } from '@/components/avatars';
import { PlayerTile, RulesPanel } from '@/components/room-bits';
import { MeldSpread, OpponentSeat, SeatIdentity } from '@/components/game/seat';
import { EventFlights, isParkedEvent, useTableEvents, type ParkedDrop } from '@/components/game/event-flights';
import { SkipSplash } from '@/components/game/skip-splash';

type Extra = Partial<Omit<Rush10PlayerAction, 'playerToken' | 'action'>>;
export type Perform = (action: Rush10PlayerAction['action'], extra?: Extra, onDone?: (updated: Rush10RoomView) => void, onError?: () => void) => void;

const EASE = [0.22, 1, 0.36, 1] as const;

export function GameTable({ room, code, selfId, rules, rulesLoading, retryRules, perform, start, isBusy, actPending, startPending, onExit, hideRoomCode = false }: {
  room: Rush10RoomView; code: string; selfId?: string;
  rules?: Rush10Rules; rulesLoading: boolean; retryRules: () => void;
  perform: Perform; start: () => void; isBusy: boolean; actPending: boolean; startPending: boolean; onExit: () => void; hideRoomCode?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dealingHand, setDealingHand] = useState(false);
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [incoming, setIncoming] = useState<IncomingDraw | null>(null);
  const [parked, setParked] = useState<ParkedDrop | null>(null);
  const [drawer, setDrawer] = useState<'scores' | 'rules' | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const flights = useTableEvents(room, selfId);
  const landedDiscard = useRef(room.discardTop);
  const discardInFlight = flights.pendingDiscards.some(event => event.card?.id === room.discardTop?.id);
  const visibleDiscard = discardInFlight ? landedDiscard.current : room.discardTop;
  useEffect(() => {
    if (!discardInFlight) landedDiscard.current = room.discardTop;
  }, [room.discardTop, discardInFlight]);

  const self = room.players.find(p => p.id === selfId);
  const currentPlayer = room.players.find(p => p.id === room.currentPlayerId);
  const isMyTurn = !!self && room.currentPlayerId === self.id;
  const isPlaying = room.status === 'playing';
  const isRoundOver = room.status === 'round-over';
  const isFinished = room.status === 'finished';
  const levelTitle = (n?: number) => rules?.phases.find(p => p.number === n)?.title;

  useEffect(() => {
    setSelected([]);
    setIncoming(null);
    setParked(null);
  }, [room.roundNumber, room.status]);

  // A dropped card stays parked until its flight lands; it leaves the hand when the server confirms.
  const incomingHits = new Set(flights.pending.flatMap(event => event.kind === 'hit' && event.card ? [event.card.id] : []));
  const parkedShown = !!parked && (room.hand.some(card => card.id === parked.card.id) || flights.pending.some(event => isParkedEvent(event, parked, selfId)));
  useEffect(() => { if (parked && !parkedShown) setParked(null); }, [parked, parkedShown]);

  // Opponents in seating order, starting after you.
  const opponents = useMemo(() => {
    const idx = room.players.findIndex(p => p.id === selfId);
    return idx < 0 ? room.players : [...room.players.slice(idx + 1), ...room.players.slice(0, idx)];
  }, [room.players, selfId]);

  // New melds get a reveal; melds present at load do not.
  const knownMelds = useRef<Set<string> | null>(null);
  if (knownMelds.current === null) knownMelds.current = new Set(room.melds.map(m => m.id));
  const freshMelds = new Set(room.melds.filter(m => !knownMelds.current!.has(m.id)).map(m => m.id));
  useEffect(() => { room.melds.forEach(m => knownMelds.current!.add(m.id)); });

  function act(action: Rush10PlayerAction['action'], extra: Extra = {}, onDone?: (updated: Rush10RoomView) => void, onError?: () => void) {
    perform(action, extra, (updated) => { setSelected([]); setTargetPlayerId(''); onDone?.(updated); }, onError);
  }

  function toggleCard(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  }

  /** Draw from a pile; the flight animation is armed only on success, from the captured pile rect. */
  function draw(action: 'draw-deck' | 'draw-discard') {
    const el = (action === 'draw-deck' ? deckRef : discardRef).current;
    const box = el?.getBoundingClientRect();
    const from = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    const before = new Set(room.hand.map(c => c.id));
    act(action, {}, (updated) => {
      const added = updated.hand.filter(c => !before.has(c.id));
      if (from && added.length === 1) setIncoming({ id: added[0].id, from, nonce: Date.now() });
    });
  }

  /** Clear on blank-space press, before hand pointer capture can retarget a card's click. */
  function boardClick(event: ReactPointerEvent) {
    if (!selected.length) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, select, input, label, a')) return;
    setSelected([]);
  }

  // Selection order is preserved in hand order so recognition is deterministic.
  const selectedCards = useMemo(() => room.hand.filter(card => selected.includes(card.id)), [room.hand, selected]);
  const recognition = useMemo(() => recognizeSelection(selectedCards, PHASE_PARTS[self?.phase ?? 0] ?? []), [selectedCards, self?.phase]);
  const showRecognition = isPlaying && !!self && !self.hasLaidPhase && recognition.status !== 'empty';
  const canLay = isPlaying && isMyTurn && room.turnState === 'discard' && !self?.hasLaidPhase && recognition.status === 'ready' && !isBusy && !dealingHand;
  function layPhase() {
    if (!canLay) return;
    act('lay-phase', { melds: recognition.melds, cardIds: recognition.melds.flatMap(m => m.cardIds) });
  }

  const hitIds = draggedId ? (selected.includes(draggedId) ? selected : [draggedId]) : selected;
  const hitCards = room.hand.filter(card => hitIds.includes(card.id));
  const canHit = isPlaying && isMyTurn && !!self?.hasLaidPhase && room.turnState === 'discard' && hitCards.length > 0 && hitCards.length === hitIds.length && !isBusy && !dealingHand;
  const canHitMeld = (meld: Rush10Meld) => canHit && multiHitTarget(hitCards, meld) !== null;
  function hit(meld: Rush10Meld) {
    const target = multiHitTarget(hitCards, meld);
    if (!canHit || target === null) return;
    act('hit', { cardIds: hitIds, meldId: meld.id, ...target });
  }

  const needsSkipTarget = (card: Rush10Card) => card.type === 'skip' && room.players.length > 2 && !targetPlayerId;
  function discard(card: Rush10Card, onError?: () => void) {
    act('discard', { cardIds: [card.id], ...(targetPlayerId ? { targetPlayerId } : {}) }, undefined, onError);
  }
  // Discarding by drag moves exactly one card; dragging part of a multi-card selection is a hit, not a discard.
  const draggedDiscard = draggedId && hitIds.length === 1 ? room.hand.find(card => card.id === draggedId) : undefined;
  const canDropDiscard = isPlaying && isMyTurn && room.turnState === 'discard' && !!draggedDiscard && !needsSkipTarget(draggedDiscard) && !isBusy && !dealingHand;

  function dropCards(id: string, x: number, y: number, rect: DropRect) {
    // Pointer capture keeps hand dragging stable; hit-test the actual drop position.
    const dropped = document.elementFromPoint(x, y);
    // Match the lifted drag card's pose (OrderedHand tilts it -5deg at 1.08x) so its flight continues from the drop.
    const park = (kind: ParkedDrop['kind'], card: Rush10Card) => {
      if (!reduce) setParked({ kind, card, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width * 1.08, rotate: -5 });
    };
    if (canDropDiscard && draggedDiscard?.id === id && dropped?.closest('[data-drop-discard]')) {
      park('discard', draggedDiscard);
      discard(draggedDiscard, () => setParked(null));
      return true;
    }
    if (!isPlaying || !isMyTurn || !self?.hasLaidPhase || room.turnState !== 'discard' || isBusy || dealingHand) return false;
    const ids = selected.includes(id) ? selected : [id];
    const cards = room.hand.filter(card => ids.includes(card.id));
    if (cards.length !== ids.length) return false;
    const element = dropped?.closest<HTMLElement>('[data-drop-meld]');
    const meld = room.melds.find(meld => meld.id === element?.dataset.dropMeld);
    if (!meld) return false;
    const target = multiHitTarget(cards, meld);
    if (!target) return false;
    park('hit', cards.find(card => card.id === id)!);
    act('hit', { cardIds: ids, meldId: meld.id, ...target }, undefined, () => setParked(null));
    return true;
  }

  const canDraw = isMyTurn && room.turnState === 'draw' && !isBusy && !dealingHand && isPlaying;
  const blockedSkipDraw = room.discardTop?.type === 'skip';
  const myMelds = room.melds.filter(m => m.ownerId === selfId);
  const lastEvent = room.events?.at(-1);
  const skippedOpponent = room.players.length === 2 && lastEvent?.kind === 'discard' && lastEvent.card?.type === 'skip' && lastEvent.playerId === selfId
    ? room.players.find(player => player.id !== selfId) : undefined;
  const turnLine = !isPlaying ? null : isMyTurn
    ? room.turnState === 'draw' ? skippedOpponent ? `it's your turn again because you skipped ${skippedOpponent.name}` : 'Your turn. Draw a card.' : 'Select cards to lay down, add to a pile, or discard to finish.'
    : `${currentPlayer?.name ?? 'Someone'} is ${room.turnState === 'draw' ? 'drawing' : 'thinking'}`;
  const handHint = room.turnState === 'discard' && isMyTurn && isPlaying ? 'Select matching cards, then tap a highlighted laid level to add them. Select one card to discard, or drag it to the discard pile.' : '';

  const over = isRoundOver || isFinished;
  const bgRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bgRef.current;
    if (!el) return;
    if (over) { el.setAttribute('inert', ''); setDrawer(null); headingRef.current?.focus({ preventScroll: true }); }
    else el.removeAttribute('inert');
  }, [over]);

  return <div className="table-felt relative min-h-[100dvh]" data-testid="game-table">
   <SkipSplash room={room} />
   <div ref={bgRef} className="game-layout relative flex min-h-[100dvh] flex-col" onPointerDown={boardClick} aria-hidden={over || undefined}>
    {/* Top rail */}
    <header className="relative z-20 flex items-center justify-between gap-3 px-4 pt-3 md:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onExit} data-testid="button-exit" className="table-chip">Exit Game</button>
        {!hideRoomCode && <span className="hidden font-mono text-[10px] uppercase tracking-[.18em] text-[#64748B] sm:inline">Room {code}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setDrawer('scores')} data-testid="button-open-scores" className="table-chip"><ListOrdered size={13} /> Scores</button>
        <button onClick={() => setDrawer('rules')} data-testid="button-open-rules" className="table-chip"><CircleHelp size={13} /> Rules</button>
      </div>
    </header>

    {/* Opponents across the top */}
    <section className="relative z-10 w-full overflow-x-auto pb-2 pt-3" aria-label="Opponents">
      <div className="mx-auto flex w-max min-w-full justify-around gap-2 px-3">
        {opponents.filter(p => p.id !== selfId).map(player => <OpponentSeat key={player.id} player={player}
          active={player.id === room.currentPlayerId && isPlaying}
          melds={room.melds.filter(m => m.ownerId === player.id)} canHit={canHitMeld} onHit={hit} freshMelds={freshMelds} incomingHits={incomingHits} />)}
      </div>
    </section>

    {/* The middle of the table */}
    <section className="game-middle relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4">
      <motion.div key="piles" className="game-piles flex flex-col items-center gap-4" initial={reduce ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.3, ease: EASE }}>
          <div className="game-pile-row flex items-end gap-8 pt-16 md:gap-14">
            <button onClick={() => draw('draw-deck')} disabled={!canDraw} data-testid="button-draw-deck" className={`pile group flex flex-col items-center gap-2 ${canDraw ? 'is-live' : ''}`}>
              <div ref={deckRef} data-pile="deck" className="relative">
                {canDraw && <ArrowDown aria-hidden="true" className="pile-turn-arrow" strokeWidth={4} />}
                <CardBack width={88} className="absolute left-0 top-0 translate-x-[5px] translate-y-[5px] opacity-60" />
                <CardBack width={88} className="absolute left-0 top-0 translate-x-[2.5px] translate-y-[2.5px] opacity-80" />
                <CardBack width={88} className="pile-top relative shadow-[0_14px_30px_rgba(0,0,0,.5)]" />
              </div>
              <span className="text-center text-[11px] font-bold text-white/80">Draw pile</span>
            </button>
            <div className="group/skip relative" data-drop-discard tabIndex={blockedSkipDraw ? 0 : undefined}
              aria-label={blockedSkipDraw ? "You can't draw a Skip from the discard pile" : undefined}>
            {blockedSkipDraw && <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 w-56 -translate-x-1/2 rounded-xl bg-[#0B1120] px-3 py-2 text-center text-sm font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/30 transition-opacity group-hover/skip:opacity-100 group-focus/skip:opacity-100">You can't draw a Skip from the discard pile</span>}
            <button onClick={() => { if (!blockedSkipDraw) draw('draw-discard'); }} disabled={!canDraw || blockedSkipDraw || !room.discardTop || discardInFlight} data-testid="button-draw-discard" className={`pile group flex flex-col items-center gap-2 ${canDraw && !blockedSkipDraw && room.discardTop && !discardInFlight ? 'is-live' : ''} ${canDropDiscard ? 'is-drop-target' : ''}`}>
              <div ref={discardRef} data-pile="discard" className="discard-drop relative" style={{ width: 88, height: 135 }}>
                {canDraw && !blockedSkipDraw && room.discardTop && !discardInFlight && <ArrowDown aria-hidden="true" className="pile-turn-arrow" strokeWidth={4} />}
                  {visibleDiscard ? <div key={visibleDiscard.id} className="absolute inset-0 rotate-[3deg]">
                    <div className="pile-top">
                      <PlayingCard card={visibleDiscard} width={88} index={2} className="shadow-[0_14px_30px_rgba(0,0,0,.5)]" />
                    </div>
                  </div> : <div className="absolute inset-0 flex items-center justify-center rounded-[14px] border-2 border-dashed border-white/25 font-mono text-[10px] uppercase tracking-widest text-white/50">Empty</div>}
              </div>
              <span className="text-center text-[11px] font-bold text-white/80">Discard pile</span>
            </button>
            </div>
          </div>
          <motion.p key={turnLine} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`text-center text-lg font-bold tracking-[-.03em] md:text-xl ${isMyTurn ? 'text-[#A3E635]' : 'text-white/85'}`} data-testid="text-turn-status" aria-live="polite">
            {!isMyTurn && currentPlayer && <AnimalAvatar kind={currentPlayer.avatar} size={22} decorative className="mr-2 inline-block -translate-y-[2px] align-middle" />}{turnLine}
          </motion.p>
        </motion.div>
    </section>

    {/* Your side of the table */}
    <section className="relative z-20 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 md:px-8" data-keep-selection>
      {self && <div className="flex items-center gap-3" data-testid="self-identity">
        <SeatIdentity player={self} active={isMyTurn && isPlaying} align="left" levelTitle={levelTitle(self.phase)} size={80} localPlayer />
      </div>}
      <div className="flex flex-1 flex-wrap justify-center gap-1" data-meld-zone={selfId}>
        {myMelds.map(meld => <MeldSpread key={meld.id} meld={meld} ownerName="your" canHit={canHitMeld(meld)} onHit={() => hit(meld)} fresh={freshMelds.has(meld.id)} incoming={incomingHits} />)}
      </div>
    </section>

    <AnimatePresence>
      {(showRecognition || canLay) && <motion.div key="recognition" className="relative z-20 flex flex-wrap items-center justify-center gap-3 px-4 pt-2" data-keep-selection
        initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2, ease: EASE }}>
        {showRecognition && <motion.p key={recognition.message} initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} aria-live="polite" data-testid="text-meld-status" data-status={recognition.status}
          className={`rounded-full px-3.5 py-1.5 text-center text-[13px] font-bold ${recognition.status === 'ready' ? 'bg-[#A3E635]/20 text-[#D9F99D]' : recognition.status === 'extra' ? 'bg-[#FFB800]/15 text-[#FDE68A]' : 'bg-white/[.07] text-white/85'}`}>{recognition.message}</motion.p>}
        {canLay && <div className="relative pt-1">
          <ArrowDown aria-hidden="true" className="pile-turn-arrow" strokeWidth={4} />
          <button onClick={layPhase} data-testid="button-lay-phase" className="table-chip is-primary">{actPending ? <LoaderCircle size={13} className="animate-spin" /> : null} Lay Down Cards</button>
        </div>}
      </motion.div>}
    </AnimatePresence>

    {/* Your hand: the lower third */}
    <section className="relative z-30 mb-[50px] mt-1 w-full pt-2" data-self-hand data-keep-selection aria-label="Your hand">
      {room.hand.length === 0 ? <p className="py-14 text-center text-sm text-[#94A3B8]">{isPlaying ? 'Your hand is empty.' : 'Your hand will appear here when the round begins.'}</p> : (
        <OrderedHand key={`${code}-${selfId}-${room.roundNumber}`} storageKey={`rush10-hand-${code}-${selfId}`}
          deal={isPlaying ? [...(room.events ?? [])].reverse().find(event => event.kind === 'deal') : undefined}
          onDealingChange={setDealingHand}
          onDragCardChange={setDraggedId} onDropCards={dropCards} hiddenIds={parkedShown ? [parked!.card.id] : undefined}
          cards={room.hand} selected={selected} toggleCard={toggleCard} color={cardColor} incoming={incoming} hint={handHint}
          locked={!isPlaying} renderAction={isPlaying && isMyTurn && room.turnState === 'discard' ? (card: Rush10Card) => <span className="flex items-center gap-1.5">{card.type === 'skip' && room.players.length > 2 && <label className="table-select"><span>Skip</span><select value={targetPlayerId} onChange={e => setTargetPlayerId(e.target.value)} onPointerDown={e => e.stopPropagation()} data-testid="select-skip-target"><option value="">Choose target</option>{room.players.filter(p => p.id !== selfId).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}<button type="button" onClick={() => discard(card)} disabled={isBusy || needsSkipTarget(card)} data-testid="button-discard" aria-label={`Discard ${cardLabel(card)}`} className="discard-pill">{actPending ? <LoaderCircle size={13} className="animate-spin" /> : <ArrowDown size={13} />} Discard</button></span> : undefined} />
      )}
    </section>

   </div>
    <AnimatePresence>
      {over && <motion.div key="round-dim" aria-hidden className="pointer-events-auto absolute inset-0 z-[80] bg-[#0B1120]/60 backdrop-blur-[3px]"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 1, ease: 'easeOut' }} />}
    </AnimatePresence>
    {over && <dialog open aria-modal="true" aria-labelledby="round-results-heading" data-testid="dialog-round-over"
      onCancel={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}
      className="round-results-overlay absolute inset-0 z-[85] m-0 flex h-full max-h-none w-full max-w-none flex-col items-center justify-center overflow-y-auto bg-transparent p-4 text-white">
      <button onClick={onExit} data-testid="button-exit-overlay" className="table-chip absolute left-4 top-3 md:left-8">Exit Game</button>
      <div className="w-full max-w-[840px]">
        <Results room={room} selfId={selfId} isFinished={isFinished} headingRef={headingRef} />
          {isRoundOver && (room.hostPlayerId === selfId
            ? <button onClick={start} disabled={isBusy} data-testid="button-next-round" className="mx-auto mt-6 flex items-center justify-center gap-2 rounded-full bg-[#FF3366] px-7 py-3.5 font-bold text-white shadow-[0_8px_24px_rgba(255,51,102,.4)] transition hover:-translate-y-0.5 active:translate-y-[1px] disabled:opacity-50">{startPending ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />} Deal the next round</button>
            : <p className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-[#94A3B8]"><LoaderCircle size={14} className="animate-spin" /> Waiting for the host to deal the next round</p>)}
      </div>
    </dialog>}
    <EventFlights current={flights.current} advance={flights.advance} selfId={selfId} parked={parkedShown ? parked : null} />

    <AnimatePresence>
      {drawer && <motion.div key="drawer" className="fixed inset-0 z-[90]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button aria-label="Close panel" className="absolute inset-0 h-full w-full bg-[#0B1120]/60 backdrop-blur-[2px]" onClick={() => setDrawer(null)} data-testid="button-close-drawer-backdrop" />
        <motion.aside role="dialog" aria-label={drawer === 'scores' ? 'Scoreboard' : 'Rules'} className="absolute right-0 top-0 flex h-full w-[min(400px,94vw)] flex-col gap-4 overflow-y-auto bg-[#111827] p-5 shadow-[-20px_0_50px_rgba(0,0,0,.5)]"
          initial={reduce ? false : { x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <button onClick={() => setDrawer('scores')} className={`table-chip ${drawer === 'scores' ? 'is-on' : ''}`} data-testid="tab-scores">Scores</button>
              <button onClick={() => setDrawer('rules')} className={`table-chip ${drawer === 'rules' ? 'is-on' : ''}`} data-testid="tab-rules">Rules</button>
            </div>
            <button onClick={() => setDrawer(null)} aria-label="Close" data-testid="button-close-drawer" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"><X size={17} /></button>
          </div>
          {drawer === 'scores' ? <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#94A3B8]">Round {room.roundNumber}</p>
            {[...room.players].sort((a, b) => b.phase - a.phase || a.score - b.score).map(p => <PlayerTile key={p.id} player={p} self={p.id === selfId} active={p.id === room.currentPlayerId && isPlaying} playing />)}
          </div> : <RulesPanel rules={rules} loading={rulesLoading} retry={retryRules} compact />}
        </motion.aside>
      </motion.div>}
    </AnimatePresence>
  </div>;
}

function Results({ room, selfId, isFinished, headingRef }: { room: Rush10RoomView; selfId?: string; isFinished: boolean; headingRef: React.RefObject<HTMLDivElement | null> }) {
  const reduce = useReducedMotion();
  const winner = room.players.find(p => p.id === room.winnerId);
  const allCompleted = room.players.length > 0 && room.players.every(player => player.hasLaidPhase);
  const emptiedHand = room.players.find(player => player.handCount === 0);
  const roundReason = allCompleted
    ? 'All players completed their level.'
    : emptiedHand ? `${emptiedHand.name} played all their cards.` : '';
  const ranked = [...room.players].sort((a, b) => a.score - b.score);
  const zoom = { initial: reduce ? false as const : { opacity: 0, scale: 3.2 }, animate: { opacity: 1, scale: 1 }, transition: { duration: reduce ? 0 : 0.9, ease: EASE } };
  return <div className="text-center" data-testid="round-results">
    <motion.div ref={headingRef} tabIndex={-1} id="round-results-heading" className="outline-none" {...zoom}>
    {isFinished ? <>
      <Trophy className="mx-auto text-[#FFB800]" size={30} />
      <h2 className="mt-2 text-4xl font-bold tracking-[-.06em] text-white md:text-5xl" data-testid="text-winner">{winner?.name ?? 'A player'} wins!</h2>
      <p className="mt-1 text-sm text-[#94A3B8]">Ten levels, done. Final scores below.</p>
    </> : <>
      <h2 className="mt-1 text-3xl font-bold tracking-[-.05em] text-white md:text-4xl">Round {room.roundNumber} Complete</h2>
      {roundReason && <p className="mt-3 text-sm font-semibold text-white" data-testid="text-round-end-reason">{roundReason}</p>}
    </>}
    </motion.div>
    <ul className="mx-auto mt-6 max-w-[380px] list-none space-y-1">
      {ranked.map((p, i) => <motion.li key={p.id} initial={reduce ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.07, ease: EASE }}
        className={`flex items-center gap-3 px-2 py-2.5 text-left ${p.id === room.winnerId ? 'text-[#A3E635]' : ''}`} data-testid={`result-row-${p.id}`}>
        <AnimalAvatar kind={p.avatar} size={34} />
        <span className="min-w-0 flex-1"><span className="block truncate font-bold">{p.name}{p.id === selfId && <span className="ml-1.5 text-[10px] font-medium text-[#94A3B8]">(you)</span>}{p.id === room.winnerId && <Crown size={13} className="ml-1.5 inline text-[#FFB800]" aria-label="Winner" />}</span>
          <span className="text-[11px] text-[#94A3B8]">Level {p.phase}{p.hasLaidPhase ? ' · level laid' : ''}</span></span>
        <span className={`font-mono font-bold ${i === 0 ? 'text-[27px] text-[#FFB800]' : 'text-lg'}`}>{p.score}</span>
      </motion.li>)}
    </ul>
  </div>;
}
