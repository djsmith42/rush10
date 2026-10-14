import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const source = await readFile(new URL('../src/routes/rush10.ts', import.meta.url), 'utf8');
const start = source.indexOf('} else if (input.action === "hit") {');
const body = source.slice(start + '} else if (input.action === "hit") {'.length, source.indexOf('} else if (input.action === "discard")', start));
const code = transformSync(body, { loader: 'ts' }).code;
const card = (id, value, type = 'number', color = 'red') => ({ id, value, type, color });
function fixture(type = 'group', cards = [card('a', 3), card('b', 3)]) {
  const player = { id: 'self', name: 'Self', hasLaidPhase: true, hand: [...cards, card('remaining', 2)] };
  const meld = { id: 'pile', ownerId: 'self', type, declaredValue: 3, declaredColor: 'red', low: 7, high: 10, cards: [], cardIds: [] };
  const room = { turnState: 'discard', players: [player], melds: [meld] };
  const input = { meldId: 'pile' };
  const context = { room, player, input, cardIds: cards.map(c => c.id), GameError: Error, recordEvent() {}, finishRound(room) { room.ended = true; } };
  return { ...context, meld, play() { runInNewContext(code, context); } };
}

for (const type of ['group', 'color']) {
  const f = fixture(type);
  f.play();
  assert.equal(f.meld.cards.length, 2);
  assert.equal(f.player.hand.length, 1);
}
for (const cards of [
  [card('a', 12), card('b', 11)],
  [card('a', 6), card('b', 11)],
  [card('a', 12), card('b', null, 'wild')],
]) {
  const f = fixture('sequence', cards);
  f.play();
  assert.equal(f.meld.cards.length, 2);
}
for (const [type, cards] of [
  ['group', [card('a', 3), card('b', 4)]],
  ['color', [card('a', 3), card('b', 4, 'number', 'blue')]],
  ['sequence', [card('a', 11), card('b', 11)]],
  ['sequence', [card('a', 6), card('b', 12)]],
  ['group', [card('a', 3), card('b', null, 'skip')]],
]) {
  const f = fixture(type, cards);
  const before = JSON.stringify(f.room);
  assert.throws(() => f.play());
  assert.equal(JSON.stringify(f.room), before, 'invalid batch must not partially change the room');
}
const duplicate = fixture();
duplicate.cardIds[1] = duplicate.cardIds[0];
assert.throws(() => duplicate.play(), /only be used once/);
const missing = fixture();
missing.cardIds[1] = 'not-in-hand';
assert.throws(() => missing.play(), /from your hand/);
console.log('PASS: multi-hit accepts valid batches and rejects invalid batches atomically. Round lifecycle is covered by round-completion.mjs.');
