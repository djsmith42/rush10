import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Rush10Meld, Rush10Player } from '@workspace/api-client-react';
import { Bot, Check, Crown, Plus } from 'lucide-react';
import { AnimalAvatar } from '@/components/avatars';
import { CardBack, PlayingCard } from '@/components/cards';
import { laidCardOrder } from '@/lib/laid-card-order';

export function meldTitle(meld: Rush10Meld) {
  const kind = meld.type === 'group' ? 'Group' : meld.type === 'sequence' ? 'Sequence' : 'Color';
  const detail = meld.declaredValue ? ` of ${meld.declaredValue}s` : meld.declaredColor ? ` · ${meld.declaredColor}` : meld.low !== null && meld.high !== null ? ` ${meld.low}–${meld.high}` : '';
  return `${kind}${detail}`;
}

/** A laid Group/Sequence: the whole spread is the hit target. */
export function MeldSpread({ meld, ownerName, canHit, onHit, fresh, incoming }: { meld: Rush10Meld; ownerName: string; canHit: boolean; onHit: () => void; fresh: boolean; incoming?: Set<string> }) {
  const cardWidth = 62.5;
  const reduce = useReducedMotion();
  const gaps = Math.max(1, meld.cards.length - 1);
  const natural = cardWidth + Math.max(18, Math.min(cardWidth * 0.5, 150 / gaps)) * (meld.cards.length - 1);
  // A pile keeps the width it was first shown at and squeezes its cards closer as more are added, widening only
  // once they would sit tighter than 18px. A pile that grew pushed the piles beside it onto a new row and the whole
  // table jumped.
  const shownWidth = useRef(natural);
  const width = Math.max(shownWidth.current, cardWidth + 18 * (meld.cards.length - 1));
  shownWidth.current = width;
  const step = meld.cards.length > 1 ? Math.min(cardWidth * 0.5, 150 / gaps, (width - cardWidth) / gaps) : 0;
  return <button type="button" onClick={onHit} disabled={!canHit} data-testid={`button-hit-${meld.id}`} data-drop-meld={meld.id} data-keep-selection
    aria-label={`Add selected cards to ${ownerName}'s ${meldTitle(meld)}${canHit ? '' : ' (select matching cards on your turn)'}`}
    className={`meld-spread group relative flex flex-col items-center gap-1 rounded-xl px-1.5 pb-1.5 pt-1 ${canHit ? 'can-hit' : ''}`}>
    <span className="flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-[#94A3B8] group-[.can-hit]:text-[#A3E635]">
      {canHit && <Plus size={10} strokeWidth={3} />}{meldTitle(meld)}
    </span>
    <span className="relative block" style={{ width, height: Math.round((cardWidth - 4) * 122 / 79 + 4) }}>
      {/* Cards still flying in from a hit stay hidden (but measurable as the flight target) until they land.
          The hiding goes through `animate`: an opacity class would lose to Motion's inline opacity. */}
      {laidCardOrder(meld).map((card, i) => <motion.span key={card.id} className="meld-card absolute top-0 block" data-meld-card={card.id}
        // Placed with x so cards slide when the pile squeezes up or a card lands between them.
        style={{ left: 0, zIndex: i + 1 }}
        initial={fresh && !reduce && !incoming?.has(card.id) ? { x: i * step, opacity: 0, y: -26, rotateY: 90, scale: 0.7 } : false}
        animate={{ x: i * step, opacity: incoming?.has(card.id) ? 0 : 1, y: 0, rotateY: 0, scale: 1 }}
        // A fresh pile flips in, fading rather than springing its opacity so no card snaps on; a landed hit swaps in at once under its flight.
        transition={fresh
          ? { delay: 0.25 + i * 0.07, type: 'spring', stiffness: 320, damping: 22, opacity: { delay: 0.25 + i * 0.07, duration: 0.2, ease: 'easeOut' } }
          : { type: 'spring', stiffness: 320, damping: 22, opacity: { duration: 0 } }}>
        <PlayingCard card={card} width={cardWidth} index={i} className="shadow-[-4px_6px_14px_rgba(0,0,0,.42)]" />
      </motion.span>)}
    </span>
  </button>;
}

export function SeatIdentity({ player, active, align = 'center', levelTitle, size = 40, localPlayer = false }: { player: Rush10Player; active: boolean; align?: 'center' | 'left'; levelTitle?: string; size?: number; localPlayer?: boolean }) {
  return <div className={`flex items-center ${localPlayer ? 'gap-6' : 'gap-2.5'} ${align === 'center' ? 'justify-center' : ''}`}>
    <span className={`seat-avatar relative shrink-0 ${active ? 'is-active' : ''}`}>
      <AnimalAvatar kind={player.avatar} size={size} />
      {player.isHost && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#FFB800] text-[#111827] ring-2 ring-[#111827]" aria-label="Host"><Crown size={9} /></span>}
    </span>
    <span className="min-w-0 text-left">
      <span className={`flex items-center gap-1 font-bold leading-tight text-white ${localPlayer ? 'text-[31.5px]' : 'max-w-[150px] text-sm'}`} data-testid={`text-player-name-${player.id}`}><span className="min-w-0 truncate">{player.name}</span>{player.isBot && <Bot size={13} className="shrink-0 text-[#94A3B8]" aria-label="Bot" />}</span>
      <span className={`flex items-center gap-1 font-semibold leading-tight ${localPlayer ? 'mt-1 text-[24.75px]' : 'text-[11px]'}`} data-testid={`text-player-level-${player.id}`}>
        <span className={`shrink-0 ${!localPlayer && player.hasLaidPhase ? 'text-[#A3E635]' : 'text-[#FFB800]'}`}>Level {player.phase}{localPlayer && levelTitle ? ':' : ''}</span>
        {localPlayer && levelTitle && <span className="font-normal text-white">{levelTitle}</span>}
        {player.hasLaidPhase && <Check size={11} strokeWidth={3} className="text-[#A3E635]" aria-label="Level laid" />}
        {!localPlayer && levelTitle && <span className="max-w-[140px] truncate font-normal text-[#94A3B8]">· {levelTitle}</span>}
      </span>
    </span>
  </div>;
}

/** Where a player's laid piles sit. Its height eases to fit them, so when piles arrive or wrap onto another row
 *  the table glides instead of jumping: the table centres its middle in whatever height the rows leave over. */
export function MeldZone({ ownerId, className = '', innerClassName = '', children }: { ownerId?: string; className?: string; innerClassName?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <motion.div className={className} initial={false} animate={{ height }}
    transition={reduce ? { duration: 0 } : { type: 'tween', duration: 0.32, ease: [0.45, 0, 0.2, 1] }}>
    <div ref={inner} className={`flex flex-wrap justify-center gap-1 ${innerClassName}`} data-meld-zone={ownerId}>{children}</div>
  </motion.div>;
}

/** Wide enough for a full fan: backs 30px wide, at most 12px apart, over 120px. */
const FAN_BOX = 150;

/** Opponent: identity, a face-down fan sized to their hand count, and their laid melds. */
export function OpponentSeat({ player, active, melds, canHit, onHit, freshMelds, incomingHits }: { player: Rush10Player; active: boolean; melds: Rush10Meld[]; canHit: (meld: Rush10Meld) => boolean; onHit: (meld: Rush10Meld) => void; freshMelds: Set<string>; incomingHits?: Set<string> }) {
  const reduce = useReducedMotion();
  const n = player.handCount;
  const backW = 30;
  const step = n > 1 ? Math.min(12, 120 / (n - 1)) : 0;
  const maxAngle = Math.min(26, n * 2.6);
  const fanW = backW + step * Math.max(0, n - 1);
  // Sized to its own content, not an equal share of the row; on narrow windows its melds wrap to a second
  // line before the row has to scroll.
  return <div className="flex min-w-[120px] flex-col items-center gap-2 px-1 md:px-2" data-testid={`seat-${player.id}`}>
    <SeatIdentity player={player} active={active} size={36} />
    {/* A fixed-width box (the widest fan), with the fan centred in it: a box that grew with the hand re-centred the
        whole seat whenever a card was dealt or drawn, and every card in it jumped. */}
    <div className="relative" style={{ width: FAN_BOX, height: 58 }} data-seat-hand={player.id} aria-label={`${player.name} holds ${n} card${n === 1 ? '' : 's'}`} role="img">
      {Array.from({ length: n }, (_, i) => {
        const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        // Positioned with x, not left, so the fan re-spreads smoothly when the count changes instead of jumping.
        return <motion.span key={i} className="absolute left-0 top-1 block" style={{ transformOrigin: '50% 140%' }}
          initial={false} animate={{ x: (FAN_BOX - fanW) / 2 + i * step, rotate: t * maxAngle, y: t * t * 6 + (active && !reduce ? -2 : 0) }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
          <CardBack width={backW} className="shadow-[-2px_3px_8px_rgba(0,0,0,.45)]" />
        </motion.span>;
      })}
      {n === 0 && <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-[#A3E635]">Out</span>}
      <span className="absolute -bottom-1 -right-4 rounded-full bg-[#0F172A] px-1.5 py-0.5 font-mono text-[9px] text-[#CBD5E1] ring-1 ring-white/10">{n}</span>
    </div>
    <MeldZone ownerId={player.id} innerClassName="min-h-[8px]">
      {melds.map(meld => <MeldSpread key={meld.id} meld={meld} ownerName={player.name} canHit={canHit(meld)} onHit={() => onHit(meld)} fresh={freshMelds.has(meld.id)} incoming={incomingHits} />)}
    </MeldZone>
  </div>;
}
