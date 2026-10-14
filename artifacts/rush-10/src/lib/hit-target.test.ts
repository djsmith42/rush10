import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rush10Card, Rush10Meld } from '@workspace/api-client-react';
import { hitTarget, multiHitTarget } from './hit-target';

const number = (value: number, color = 'red'): Rush10Card => ({ id: 'card', type: 'number', value, color });
const wild: Rush10Card = { id: 'wild', type: 'wild', value: null, color: null };
const meld = (type: Rush10Meld['type'], overrides: Partial<Rush10Meld> = {}): Rush10Meld => ({
  id: 'meld', ownerId: 'player', type, cards: [], cardIds: [],
  declaredValue: 3, declaredColor: 'red', low: 7, high: 10, ...overrides,
});
test('Groups and Color collections only accept matching numbers/colors or Wilds', () => {
  assert.deepEqual(hitTarget(number(3), meld('group')), {});
  assert.equal(hitTarget(number(4), meld('group')), null);
  assert.deepEqual(hitTarget(number(4), meld('color')), {});
  assert.equal(hitTarget(number(4, 'blue'), meld('color')), null);
  for (const type of ['group', 'color'] as const) assert.deepEqual(hitTarget(wild, meld(type)), {});
});
test('Sequences accept only legal ends, including Wilds and 1–12 boundaries', () => {
  assert.deepEqual(hitTarget(number(6), meld('sequence')), { declaredValue: 6 });
  assert.deepEqual(hitTarget(number(11), meld('sequence')), { declaredValue: 11 });
  for (const value of [1, 7, 8, 9, 10, 12]) assert.equal(hitTarget(number(value), meld('sequence')), null);
  assert.deepEqual(hitTarget(wild, meld('sequence')), { declaredValue: 6 });
  assert.deepEqual(hitTarget(wild, meld('sequence', { low: 1 })), { declaredValue: 11 });
  assert.deepEqual(hitTarget(wild, meld('sequence', { high: 12 })), { declaredValue: 6 });
  assert.equal(hitTarget(wild, meld('sequence', { low: 1, high: 12 })), null);
});
test('Skip and absent cards never enable a target', () => {
  for (const type of ['group', 'color', 'sequence'] as const) {
    assert.equal(hitTarget(undefined, meld(type)), null);
    assert.equal(hitTarget({ ...wild, type: 'skip' }, meld(type)), null);
  }
});

test('multi-card Groups and Colors require every card to fit', () => {
  assert.deepEqual(multiHitTarget([number(3), number(3), wild], meld('group')), {});
  assert.equal(multiHitTarget([number(3), number(4)], meld('group')), null);
  assert.deepEqual(multiHitTarget([number(2), number(8), wild], meld('color')), {});
  assert.equal(multiHitTarget([number(2), number(8, 'blue')], meld('color')), null);
  assert.equal(multiHitTarget([], meld('group')), null);
  assert.equal(multiHitTarget([number(3), { ...wild, type: 'skip' }], meld('group')), null);
});

test('multi-card Sequences accept unordered extensions on both ends and Wild-filled gaps', () => {
  const seq = meld('sequence');
  for (const cards of [[number(12), number(11)], [number(5), number(6)], [number(6), number(11)], [number(12), wild]]) {
    assert.deepEqual(multiHitTarget(cards, seq), {});
  }
  for (const cards of [[number(12), number(5)], [number(11), number(11)], [number(7), wild], [number(1), wild]]) {
    assert.equal(multiHitTarget(cards, seq), null);
  }
  assert.equal(multiHitTarget([wild, wild], meld('sequence', { low: 1, high: 11 })), null);
});
