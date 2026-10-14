import type { Rush10Meld } from '@workspace/api-client-react';

/** Use the server's declared interval, not a Wild's position in selection order. */
export function laidCardOrder(meld: Pick<Rush10Meld, 'type' | 'cards' | 'low' | 'high'>) {
  if (meld.type !== 'sequence' || meld.low == null || meld.high == null) return meld.cards;
  const naturals = new Map(meld.cards.filter(card => card.type === 'number').map(card => [card.value, card]));
  const wilds = meld.cards.filter(card => card.type === 'wild');
  let wildIndex = 0;
  const ordered: Rush10Meld['cards'] = [];
  for (let value = meld.low; value <= meld.high; value++) {
    const card = naturals.get(value) ?? wilds[wildIndex++];
    if (!card) return meld.cards;
    ordered.push(card);
  }
  return ordered.length === meld.cards.length ? ordered : meld.cards;
}
