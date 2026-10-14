import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/routes/rush10.ts', import.meta.url), 'utf8');
const start = source.indexOf('const top = room.discardPile.at(-1);');
assert.ok(start > 0);
const guard = source.slice(start, source.indexOf('const card = room.discardPile.pop();', start));
const check = room => runInNewContext(guard, { room, GameError: Error });
for (const count of [2, 3, 4, 5, 6]) {
  for (const owner of ['self', 'other', null]) {
    const room = {
      players: Array.from({ length: count }, () => ({})),
      discardPile: [{ id: 'number', type: 'number' }, { id: 'skip', type: 'skip' }],
      events: owner ? [{ kind: 'discard', playerId: owner, card: { id: 'skip', type: 'skip' } }] : [],
    };
    const before = JSON.stringify(room);
    assert.throws(() => check(room), /You can't draw a Skip from the discard pile/);
    assert.equal(JSON.stringify(room), before, 'rejected draw leaves room unchanged');
  }
}
for (const type of ['number', 'wild']) check({ discardPile: [{ type }] });
check({ discardPile: [] });
console.log('PASS: all players are blocked from drawing discarded Skips; number and Wild draws remain allowed.');
