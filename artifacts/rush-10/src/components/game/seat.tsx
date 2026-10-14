import { motion, useReducedMotion } from 'framer-motion';
import type { Rush10Meld, Rush10Player } from '@workspace/api-client-react';
import { Check, Crown, Plus } from 'lucide-react';
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
  const step = Math.max(18, Math.min(cardWidth * 0.5, 150 / Math.max(1, meld.cards.length - 1)));
  const width = cardWidth + step * Math.max(0, meld.cards.length - 1);
  return <button type="button" onClick={onHit} disabled={!canHit} data-testid={`button-hit-${meld.id}`} data-drop-meld={meld.id} data-keep-selection
    aria-label={`Add selected cards to ${ownerName}'s ${meldTitle(meld)}${canHit ? '' : ' (select matching cards on your turn)'}`}
    className={`meld-spread group relative flex flex-col items-center gap-1 rounded-xl px-1.5 pb-1.5 pt-1 ${canHit ? 'can-hit' : ''}`}>
    <span className="flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-[#94A3B8] group-[.can-hit]:text-[#A3E635]">
      {canHit && <Plus size={10} strokeWidth={3} />}{meldTitle(meld)}
    </span>
    <span className="relative block" style={{ width, height: Math.round((cardWidth - 4) * 122 / 79 + 4) }}>
      {/* Cards still flying in from a hit stay hidden (but measurable as the flight target) until they land. */}
      {laidCardOrder(meld).map((card, i) => <motion.span key={card.id} className={`meld-card absolute top-0 block ${incoming?.has(card.id) ? 'opacity-0' : ''}`} data-meld-card={card.id}
        style={{ left: i * step, zIndex: card.type === 'wild' ? i + 1 : meld.cards.length + i + 1 }}
        initial={fresh && !reduce ? { opacity: 0, y: -26, rotateY: 90, scale: 0.7 } : false}
        animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
        transition={{ delay: 0.25 + i * 0.07, type: 'spring', stiffness: 320, damping: 22 }}>
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
      <span className={`block truncate font-bold leading-tight text-white ${localPlayer ? 'text-[31.5px]' : 'max-w-[150px] text-sm'}`} data-testid={`text-player-name-${player.id}`}>{player.name}</span>
      <span className={`flex items-center gap-1 font-semibold leading-tight ${localPlayer ? 'mt-1 text-[24.75px]' : 'text-[11px]'}`} data-testid={`text-player-level-${player.id}`}>
        <span className={`shrink-0 ${!localPlayer && player.hasLaidPhase ? 'text-[#A3E635]' : 'text-[#FFB800]'}`}>Level {player.phase}{localPlayer && levelTitle ? ':' : ''}</span>
        {localPlayer && levelTitle && <span className="font-normal text-white">{levelTitle}</span>}
        {player.hasLaidPhase && <Check size={11} strokeWidth={3} className="text-[#A3E635]" aria-label="Level laid" />}
        {!localPlayer && levelTitle && <span className="max-w-[140px] truncate font-normal text-[#94A3B8]">· {levelTitle}</span>}
      </span>
    </span>
  </div>;
}

/** Opponent: identity, a face-down fan sized to their hand count, and their laid melds. */
export function OpponentSeat({ player, active, melds, canHit, onHit, freshMelds, incomingHits }: { player: Rush10Player; active: boolean; melds: Rush10Meld[]; canHit: (meld: Rush10Meld) => boolean; onHit: (meld: Rush10Meld) => void; freshMelds: Set<string>; incomingHits?: Set<string> }) {
  const reduce = useReducedMotion();
  const n = player.handCount;
  const backW = 30;
  const step = n > 1 ? Math.min(12, 120 / (n - 1)) : 0;
  const maxAngle = Math.min(26, n * 2.6);
  const fanW = backW + step * Math.max(0, n - 1);
  return <div className="flex min-w-[168px] flex-1 flex-col items-center gap-2 px-2" data-testid={`seat-${player.id}`}>
    <SeatIdentity player={player} active={active} size={36} />
    <div className="relative" style={{ width: Math.max(fanW, 40), height: 58 }} data-seat-hand={player.id} aria-label={`${player.name} holds ${n} card${n === 1 ? '' : 's'}`} role="img">
      {Array.from({ length: n }, (_, i) => {
        const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        return <motion.span key={i} className="absolute top-1 block" style={{ left: i * step, transformOrigin: '50% 140%' }}
          initial={false} animate={{ rotate: t * maxAngle, y: t * t * 6 + (active && !reduce ? -2 : 0) }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
          <CardBack width={backW} className="shadow-[-2px_3px_8px_rgba(0,0,0,.45)]" />
        </motion.span>;
      })}
      {n === 0 && <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-[#A3E635]">Out</span>}
      <span className="absolute -bottom-1 -right-4 rounded-full bg-[#0F172A] px-1.5 py-0.5 font-mono text-[9px] text-[#CBD5E1] ring-1 ring-white/10">{n}</span>
    </div>
    <div className="flex min-h-[8px] flex-wrap justify-center gap-1" data-meld-zone={player.id}>
      {melds.map(meld => <MeldSpread key={meld.id} meld={meld} ownerName={player.name} canHit={canHit(meld)} onHit={() => onHit(meld)} fresh={freshMelds.has(meld.id)} incoming={incomingHits} />)}
    </div>
  </div>;
}
