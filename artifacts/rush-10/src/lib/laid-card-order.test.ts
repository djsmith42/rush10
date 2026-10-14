import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rush10Card } from '@workspace/api-client-react';
import { laidCardOrder } from './laid-card-order';

const cards = (values: (number | 'W')[]): Rush10Card[] => values.map((value, i) => ({
  id: String(i), type: value === 'W' ? 'wild' : 'number',
  value: value === 'W' ? null : value, color: value === 'W' ? null : 'red',
}));
test('orders sequences and fills missing positions with Wilds without mutating input', () => {
  for (const [values, low, high, expected] of [
    [[10, 7, 9, 'W'], 7, 10, [7, 'W', 9, 10]],
    [[4, 1, 3, 2], 1, 4, [1, 2, 3, 4]],
    [[9, 'W', 7, 'W'], 7, 10, [7, 'W', 9, 'W']],
    [[10, 7, 9, 'W', 6], 6, 10, [6, 7, 'W', 9, 10]],
    [[9, 'W', 10, 7, 'W'], 6, 10, ['W', 7, 'W', 9, 10]],
  ] as [(number | 'W')[], number, number, (number | 'W')[]][]) {
    const input = cards(values);
    const snapshot = JSON.stringify(input);
    const output = laidCardOrder({ type: 'sequence', cards: input, low, high });
    assert.deepEqual(output.map(card => card.value ?? 'W'), expected);
    assert.equal(new Set(output.map(card => card.id)).size, input.length);
    assert.equal(JSON.stringify(input), snapshot);
  }
});
test('leaves Groups and Color cards alone', () => {
  const input = cards([3, 'W', 3]);
  for (const type of ['group', 'color'] as const) {
    assert.equal(laidCardOrder({ type, cards: input, low: null, high: null }), input);
  }
});
