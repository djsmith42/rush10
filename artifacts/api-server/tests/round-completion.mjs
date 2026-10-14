import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const source = await readFile(new URL('../src/routes/rush10.ts', import.meta.url), 'utf8');
const completion = source.slice(source.indexOf('function completeRoundIfNeeded('), source.indexOf('function handleError('));
const hitStart = source.indexOf('} else if (input.action === "hit") {');
const hit = source.slice(hitStart + '} else if (input.action === "hit") {'.length, source.indexOf('} else if (input.action === "discard")', hitStart));
assert.match(source, /completeRoundIfNeeded\(room\);\s+return toView\(room, player\)/, 'all moves use completion check');
assert.match(source, /completeRoundIfNeeded\(latest\)/, 'saved-room recovery uses completion check');
const card = (id, value) => ({ id, value, type: 'number', color: 'red' });
function fixture() {
  const player = { id: 'self', name: 'Test Player', phase: 1, score: 5, hasLaidPhase: true, hand: [card('a', 3), card('b', 3)] };
  const other = { id: 'other', name: 'Other', phase: 1, score: 10, hasLaidPhase: false, hand: [card('c', 12)] };
  const room = { status: 'playing', turnState: 'discard', currentPlayerId: player.id, players: [player, other],
    skippedPlayerIds: new Set(), melds: [{ id: 'pile', ownerId: player.id, type: 'group', declaredValue: 3, cards: [], cardIds: [], low: null, high: null }] };
  return { room, player, other, input: { meldId: 'pile' }, cardIds: ['a', 'b'], GameError: Error, recordEvent() {} };
}
function run(context, action = '') {
  runInNewContext(transformSync(completion + action + '\ncompleteRoundIfNeeded(room);', { loader: 'ts' }).code, context);
}

for (const owner of ['self', 'other']) {
  for (const count of [1, 2]) {
    const ctx = fixture();
    ctx.room.melds[0].ownerId = owner;
    ctx.player.hand = ctx.player.hand.slice(0, count);
    ctx.cardIds = ctx.player.hand.map(card => card.id);
    run(ctx, hit);
    assert.equal(ctx.player.hand.length, 0);
    assert.equal(ctx.room.status, 'round-over');
    assert.equal(ctx.room.currentPlayerId, null);
    assert.equal(ctx.room.turnState, 'waiting');
    assert.equal(ctx.player.phase, 2);
    assert.equal(ctx.other.score, 20);
    const scored = JSON.stringify(ctx.room);
    run(ctx);
    assert.equal(JSON.stringify(ctx.room), scored, 'repeated checks do not rescore');
  }
}
const recovered = fixture();
recovered.player.hand = [];
run(recovered);
assert.equal(recovered.room.status, 'round-over', 'stuck saved game recovers');

const all = fixture();
all.other.hasLaidPhase = true;
run(all);
assert.equal(all.room.status, 'round-over');
assert.match(all.room.message, /Everyone completed/);

const ongoing = fixture();
run(ongoing);
assert.equal(ongoing.room.status, 'playing');
assert.equal(ongoing.other.score, 10);

const won = fixture();
won.player.phase = 10;
run(won, hit);
assert.equal(won.room.status, 'finished');
assert.equal(won.room.winnerId, 'self');
console.log('PASS: final single/batch hits onto own/opponent piles complete rounds, score once, recover saved games, and finish Level 10.');
