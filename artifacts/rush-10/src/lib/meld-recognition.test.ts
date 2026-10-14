import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_PARTS, recognizeSelection, sequenceWindow, type MeldRequest, type RCard } from './meld-recognition';

let seq = 0;
const n = (value: number, color = 'red'): RCard => ({ id: `n${value}${color}-${seq++}`, type: 'number', value, color });
const W = (): RCard => ({ id: `w-${seq++}`, type: 'wild', value: null, color: null });
const S = (): RCard => ({ id: `s-${seq++}`, type: 'skip', value: null, color: null });
const shuffle = <T,>(xs: T[]) => xs.filter((_, i) => i % 2).concat(xs.filter((_, i) => !(i % 2)));

/** Re-implementation of the server's validatePhaseInput, to prove melds would be accepted. */
function serverAccepts(level: number, melds: MeldRequest[], hand: RCard[]) {
  const parts = [...PHASE_PARTS[level]];
  if (melds.length !== parts.length) return false;
  const ids = melds.flatMap(m => m.cardIds);
  if (new Set(ids).size !== ids.length) return false;
  const byId = new Map(hand.map(c => [c.id, c]));
  for (const m of melds) {
    const i = parts.findIndex(p => p.type === m.type && p.size === m.cardIds.length);
    if (i < 0) return false;
    const [part] = parts.splice(i, 1);
    const cards = m.cardIds.map(id => byId.get(id)!);
    if (cards.some(c => !c || c.type === 'skip')) return false;
    const nat = cards.filter(c => c.type === 'number');
    if (m.type === 'group') {
      const v = m.declaredValue ?? nat[0]?.value ?? null;
      if (v === null || v < 1 || v > 12 || nat.some(c => c.value !== v)) return false;
    } else if (m.type === 'sequence') {
      if (!sequenceWindow(nat.map(c => c.value!), part.size, cards.length - nat.length)) return false;
    } else {
      const colors = new Set(nat.map(c => c.color));
      const color = m.declaredColor ?? (colors.size === 1 ? [...colors][0] : null);
      if (!color || colors.size > 1 || (colors.size === 1 && !colors.has(color))) return false;
    }
  }
  return true;
}

function expectReady(level: number, cards: RCard[]) {
  for (const order of [cards, [...cards].reverse(), shuffle(cards)]) {
    const r = recognizeSelection(order, PHASE_PARTS[level]);
    assert.equal(r.status, 'ready', `level ${level}: ${r.message}`);
    assert.match(r.message, /You are ready to lay down\.$/);
    assert.ok(serverAccepts(level, r.melds, cards), `server rejects level ${level}`);
    assert.equal(r.melds.flatMap(m => m.cardIds).length, cards.length);
  }
}

test('all ten levels recognize a valid lay-down', () => {
  expectReady(1, [n(3), n(3, 'blue'), n(3, 'green'), n(9), n(9, 'yellow'), W()]);
  expectReady(2, [n(7), n(7, 'blue'), n(7, 'green'), n(2), n(3), n(4), n(5)]);
  expectReady(3, [n(11), n(11, 'blue'), W(), n(11, 'yellow'), n(6), n(7), n(8), n(9)]);
  expectReady(4, [n(1), n(2), n(3), W(), n(5), n(6), n(7)]);
  expectReady(5, [n(5), n(6), n(7), n(8), n(9), n(10), n(11), n(12)]);
  expectReady(6, [n(2), W(), n(4), n(5), W(), n(7), n(8), n(9), n(10)]);
  expectReady(7, [n(4), n(4), n(4), n(4), n(10), n(10), W(), W()]);
  expectReady(8, [n(1, 'green'), n(4, 'green'), n(4, 'green'), n(9, 'green'), n(12, 'green'), W(), n(2, 'green')]);
  expectReady(9, [n(6), n(6), n(6), W(), n(6), n(1), n(1)]);
  expectReady(10, [n(8), n(8), n(8), n(8), n(8), n(2), W(), n(2)]);
});

test('level 2 reported examples: group plus sequence, any order, with message', () => {
  const a = [n(5), n(9, 'blue'), n(5, 'green'), n(10), n(5, 'yellow'), n(11, 'green'), n(12)];
  const r = recognizeSelection(a, PHASE_PARTS[2]);
  assert.equal(r.status, 'ready');
  assert.equal(r.message, 'You have a Group of 3 and a Sequence of 4! You are ready to lay down.');
  const partial = recognizeSelection(a.slice(0, 5).filter(c => c.value === 5), PHASE_PARTS[2]);
  assert.equal(partial.message, 'You have a Group of 3!');
  expectReady(2, [n(2), W(), n(2, 'blue'), n(8), W(), n(10), n(11)]);
});

test('ambiguous allocation of a duplicated value between group and sequence', () => {
  // 5 is needed both in the Group and the Sequence; greedy grouping of all 5s fails.
  expectReady(2, [n(5), n(5, 'blue'), n(5, 'green'), W(), n(4), n(6), n(7)]);
  expectReady(2, [n(4), n(5), n(5, 'blue'), n(5, 'green'), n(6), n(7), W()]);
});

test('wild-only melds get declared value/color and wild sequence windows match server', () => {
  const r = recognizeSelection([W(), W(), W(), n(1), n(2), n(3), n(4)], PHASE_PARTS[2]);
  assert.equal(r.status, 'ready');
  assert.equal(r.melds.find(m => m.type === 'group')!.declaredValue, 12);
  const c = recognizeSelection(Array.from({ length: 7 }, W), PHASE_PARTS[8]);
  assert.equal(c.status, 'ready');
  assert.equal(c.melds[0].declaredColor, 'red');
  assert.deepEqual(sequenceWindow([12], 4, 3), { low: 9, high: 12 });
  const s = recognizeSelection([n(12), W(), W(), W(), n(1), n(1), n(1)], PHASE_PARTS[2]);
  assert.equal(s.parts.find(p => p.type === 'sequence')!.low, 9);
});

test('two identical groups use disjoint cards', () => {
  const r = recognizeSelection([n(3), n(3), n(3), n(3), n(3), W()], PHASE_PARTS[1]);
  assert.equal(r.status, 'ready');
  const ids = r.melds.flatMap(m => m.cardIds);
  assert.equal(new Set(ids).size, 6);
  assert.equal(recognizeSelection([n(3), n(3), n(3), n(3), n(3)], PHASE_PARTS[1]).status, 'partial');
});

test('extra selections never produce a playable lay-down', () => {
  const r = recognizeSelection([n(7), n(7), n(7), n(2), n(3), n(4), n(5), n(11)], PHASE_PARTS[2]);
  assert.equal(r.status, 'extra');
  assert.equal(r.melds.length, 0);
  assert.match(r.message, /1 extra card\. Deselect it/);
  const skip = recognizeSelection([n(7), n(7), n(7), n(2), n(3), n(4), n(5), S()], PHASE_PARTS[2]);
  assert.equal(skip.status, 'extra');
});

test('invalid and partial selections', () => {
  assert.equal(recognizeSelection([n(1), n(1), n(2), n(4), n(5), n(6), n(9)], PHASE_PARTS[2]).status !== 'ready', true);
  assert.equal(recognizeSelection([n(2), n(2), n(3), n(4), n(5), n(6)], PHASE_PARTS[2]).status, 'partial');
  assert.equal(recognizeSelection([n(1), n(1), n(2), n(3), n(4), n(5), n(6)], PHASE_PARTS[4]).status, 'partial');
  assert.equal(recognizeSelection([n(1, 'red'), n(2, 'blue'), n(3, 'red'), n(4, 'red'), n(5, 'red'), n(6, 'red'), n(7, 'red')], PHASE_PARTS[8]).status, 'partial');
  assert.equal(recognizeSelection([n(4)], PHASE_PARTS[2]).status, 'empty');
  assert.equal(recognizeSelection([S(), S()], PHASE_PARTS[1]).status, 'none');
  const building = recognizeSelection([n(2), n(3), n(4)], PHASE_PARTS[2]);
  assert.match(building.message, /Sequence of 4 \(3 of 4\)/);
});

test('bounded at 11 cards and stays fast', () => {
  const t = Date.now();
  const r = recognizeSelection([n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8), n(9), W(), W(), n(12)], PHASE_PARTS[6]);
  assert.equal(r.status, 'extra');
  assert.ok(Date.now() - t < 1000);
});
