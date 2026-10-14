// Exercise the actual pure route validators without starting a database/server.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/routes/rush10.ts', import.meta.url), 'utf8');
const constants = source.slice(source.indexOf('const COLORS:'), source.indexOf('const TURN_RULES'));
const validators = source.slice(source.indexOf('function validateGroup('), source.indexOf('function advanceTurn('));
const { code } = await transform(`${constants}\n${validators}\n globalThis.validate = validatePhaseInput;`, { loader: 'ts' });
const context = {
  GameError: Error, randomUUID: () => 'meld',
  removeCardsFromHand: (player, ids) => { player.hand = player.hand.filter(card => !ids.includes(card.id)); },
};
runInNewContext(code, context);
let id = 0;
const cards = values => values.map(value => ({ id: String(++id), type: value === 'W' ? 'wild' : 'number', value: value === 'W' ? null : value, color: value === 'W' ? null : 'red' }));
function lay(parts, level = 2) {
  const hand = parts.flatMap(part => part.cards);
  const player = { id: 'player', phase: level, hand };
  const melds = context.validate(player, parts.map(part => ({ type: part.type, cardIds: part.cards.map(card => card.id) })));
  assert.equal(player.hand.length, 0);
  return melds;
}
for (const reverse of [false, true]) {
  for (const wild of [false, true]) {
    const parts = [
      { type: 'group', cards: cards(wild ? [3, 3, 3] : [7, 7, 7]) },
      { type: 'sequence', cards: cards(wild ? [7, 'W', 9, 10] : [1, 2, 3, 4]) },
    ];
    const melds = lay(reverse ? parts.reverse() : parts);
    const sequence = melds.find(meld => meld.type === 'sequence');
    assert.equal(sequence.low, wild ? 7 : 1);
    assert.equal(sequence.high, wild ? 10 : 4);
  }
}
assert.throws(() => lay([{ type: 'group', cards: cards([3, 3, 3]) }, { type: 'sequence', cards: cards([7, 7, 9, 10]) }]), /repeat/);
assert.throws(() => lay([{ type: 'group', cards: cards([3, 3, 3]) }, { type: 'sequence', cards: cards([1, 2, 9, 'W']) }]), /consecutive/);
assert.throws(() => lay([{ type: 'group', cards: cards([3, 3, 3]) }, { type: 'group', cards: cards([7, 7, 7, 7]) }]), /requires/);
lay([{ type: 'group', cards: cards([2, 2]) }, { type: 'group', cards: cards([5, 5, 5, 5, 5]) }], 9);
console.log('PASS: both reported Level 2 combinations in either order; Wild fills 8; invalid melds rejected; reversed unequal Groups accepted.');
