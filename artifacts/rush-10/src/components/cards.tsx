import type { CSSProperties } from 'react';
import type { Rush10Card } from '@workspace/api-client-react';

/** Shared Rush 10 palette tokens. */
export const SUIT = {
  red: '#FF3366', blue: '#2979FF', green: '#00C896', yellow: '#FFB800',
  wild: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)', skip: '#FF6B35',
} as const;
export type SuitKey = keyof typeof SUIT;
/** Readable ink per suit: never white on bright yellow. */
export function suitInk(suit: SuitKey) { return suit === 'yellow' ? '#111827' : '#FFFFFF'; }
export const CARD_FACE = '#F8FAFC';
/** Corner-label colour on the ceramic face; amber deepened for legibility. */
export function suitLabel(suit: SuitKey) { return suit === 'yellow' ? '#B45309' : suit === 'wild' || suit === 'skip' ? '#FFFFFF' : SUIT[suit]; }
export function isSpecial(suit: SuitKey) { return suit === 'wild' || suit === 'skip'; }
export function suitOf(card: Rush10Card, index: number): SuitKey {
  if (card.type === 'wild') return 'wild';
  if (card.type === 'skip') return 'skip';
  const key = (card.color ?? '').toLowerCase();
  if (key.includes('red') || key.includes('coral')) return 'red';
  if (key.includes('green') || key.includes('teal')) return 'green';
  if (key.includes('blue')) return 'blue';
  if (key.includes('yellow') || key.includes('gold')) return 'yellow';
  return (['red', 'blue', 'green', 'yellow'] as const)[index % 4];
}
export function cardColor(card: Rush10Card, index: number) {
  const suit = suitOf(card, index);
  return isSpecial(suit) ? SUIT[suit] : CARD_FACE;
}
export function cardLabel(card: Rush10Card) {
  return card.type === 'number' ? `${card.color} ${card.value}` : card.type;
}

export function CardInside({ card, compact = false }: { card: Rush10Card; compact?: boolean }) {
  const label = card.type === 'wild' ? 'W' : card.type === 'skip' ? 'SKIP' : String(card.value ?? '?');
  // A crossed seven keeps the slanted card style without resembling Bangers' 1.
  const glyph = card.type === 'number' && card.value === 7
    ? <svg viewBox="0 0 44 64" aria-hidden="true" style={{ display: 'inline-block', width: '.64em', height: '.9em', verticalAlign: 'baseline' }} fill="currentColor">
        <path d="M8 6H42L20 60H9L31 16H6Z M10 32H33L30 39H7Z" />
      </svg>
    : label;
  const suit = suitOf(card, 0);
  const special = isSpecial(suit);
  const big = `card-lettering leading-none tracking-[-.03em] ${card.type === 'skip' ? compact ? 'text-[13px]' : 'text-[29px]' : compact ? 'text-[25px]' : 'text-[55px]'}`;
  return <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[10px] p-2 text-left" style={{ color: suitLabel(suit) }}>
    <span className={`card-lettering leading-none ${compact ? 'text-[10.5px]' : 'text-[15px]'}`}>{glyph}</span>
    {special
      ? <span className={`self-center text-white drop-shadow-[0_2px_4px_rgba(0,0,0,.25)] ${big}`}>{label}</span>
      : <span className={`self-center text-center px-1 ${big}`} style={{ color: suitLabel(suit) }}>{glyph}</span>}
    <span className={`rotate-180 self-end card-lettering leading-none ${compact ? 'text-[10.5px]' : 'text-[15px]'}`}>{glyph}</span>
  </div>;
}

/** The original 83x126 face (79x122 inside its border), uniformly scaled to any width. */
export const FACE_W = 79;
export const FACE_H = 122;
export function cardHeight(width: number) { return Math.round((width - 4) * FACE_H / FACE_W + 4); }

export function ScaledFace({ card, innerWidth }: { card: Rush10Card; innerWidth: number }) {
  return <div aria-hidden className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: FACE_W, height: FACE_H, transform: `scale(${innerWidth / FACE_W})` }}>
    <CardInside card={card} />
  </div>;
}

/** A complete ceramic card at a given width. */
export function PlayingCard({ card, width, index = 0, className = '', style }: { card: Rush10Card; width: number; index?: number; className?: string; style?: CSSProperties }) {
  return <div className={`relative overflow-hidden border-2 border-[#CBD5E1] ${className}`}
    style={{ width, height: cardHeight(width), borderRadius: width * 0.157, background: cardColor(card, index), ...style }}>
    <ScaledFace card={card} innerWidth={width - 4} />
  </div>;
}

/** Violet patterned back. */
export function CardBack({ width, className = '', style }: { width: number; className?: string; style?: CSSProperties }) {
  const h = cardHeight(width);
  return <div className={`card-back flex items-center justify-center border-[#F8FAFC] ${className}`}
    style={{ width, height: h, borderRadius: width * 0.157, borderWidth: width > 50 ? 3 : 2, ...style }}>
    {width >= 56 && <div className="flex items-center justify-center rounded-lg border border-white/50 bg-[#4F46E5]/70 font-bold text-white" style={{ width: width * 0.72, height: h * 0.78 }}>
      <span className="text-center leading-[.9]" style={{ fontSize: width * 0.15 }}>RUSH<br /><span className="tracking-[-.1em]" style={{ fontSize: width * 0.34 }}>10</span></span>
    </div>}
  </div>;
}
