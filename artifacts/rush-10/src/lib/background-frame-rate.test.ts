import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundFrameMonitor } from './background-frame-rate';

test('smooth 60fps and 120fps backgrounds keep animating', () => {
  for (const fps of [60, 120]) {
    const monitor = createBackgroundFrameMonitor();
    for (let i = 0; i < fps * 12; i++) assert.equal(monitor.sample(i * 1000 / fps), false);
  }
});

test('sustained 30fps freezes the background after two windows', () => {
  const monitor = createBackgroundFrameMonitor();
  let frozen = false;
  for (let i = 0; i <= 125; i++) frozen ||= monitor.sample(i * 1000 / 30);
  assert.equal(frozen, true);
});

test('an isolated hitch does not disable motion; hidden-tab resets discard old samples', () => {
  const monitor = createBackgroundFrameMonitor();
  monitor.sample(0);
  assert.equal(monitor.sample(2100), false);
  for (let i = 1; i <= 130; i++) assert.equal(monitor.sample(2100 + i * 1000 / 60), false);
  monitor.reset();
  assert.equal(monitor.sample(100000), false);
  for (let i = 1; i <= 130; i++) assert.equal(monitor.sample(100000 + i * 1000 / 60), false);
});
