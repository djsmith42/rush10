import type { Rush10Card, Rush10Meld } from '@workspace/api-client-react';

/** Validate the entire selection together, including Wild-filled sequence gaps. */
export function multiHitTarget(cards: Rush10Card[], meld: Rush10Meld): { declaredValue?: number } | null {
  if (!cards.length || cards.some(card => card.type === 'skip')) return null;
  if (cards.length === 1) return hitTarget(cards[0], meld);
  if (meld.type !== 'sequence') return cards.every(card => hitTarget(card, meld) !== null) ? {} : null;
  if (meld.low == null || meld.high == null) return null;
  const numbers = cards.filter(card => card.type === 'number').map(card => card.value!);
  if (new Set(numbers).size !== numbers.length || numbers.some(n => n >= meld.low! && n <= meld.high!)) return null;
  const size = meld.high - meld.low + 1 + cards.length;
  for (let low = Math.max(1, meld.low - cards.length); low <= meld.low; low++) {
    const high = low + size - 1;
    if (high >= meld.high && high <= 12 && numbers.every(n => n >= low && n <= high)) return {};
  }
  return null;
}

/** Null means illegal; otherwise the exact payload for the server's hit rules. */
export function hitTarget(card: Rush10Card | undefined, meld: Rush10Meld): { declaredValue?: number } | null {
  if (!card || card.type === 'skip') return null;
  if (meld.type === 'group') return card.type === 'wild' || card.value === meld.declaredValue ? {} : null;
  if (meld.type === 'color') return card.type === 'wild' || card.color === meld.declaredColor ? {} : null;
  if (meld.low == null || meld.high == null) return null;
  const ends = [meld.low - 1, meld.high + 1].filter(value => value >= 1 && value <= 12);
  const value = ends.find(value => card.type === 'wild' || card.value === value);
  return value == null ? null : { declaredValue: value };
}
