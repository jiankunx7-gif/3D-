import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsOverlap, resolveCollisionMove, spawnBeside, worldBounds } from '../src/collision.ts';

const unit = { min: [-.5, -.5, -.5], max: [.5, .5, .5] };

test('new instances spawn beside existing geometry without overlap', () => {
  const first = worldBounds(unit, [0, 0, 0]);
  const secondPosition = spawnBeside(unit, [first], 0, 0);
  const second = worldBounds(unit, secondPosition);
  assert.equal(boundsOverlap(first, second), false);
  assert.ok(second.min[0] > first.max[0]);
});

test('swept collision stops at contact and prevents tunnelling', () => {
  const obstacle = worldBounds(unit, [2, 0, 0]);
  const resolved = resolveCollisionMove([0, 0, 0], [8, 0, 0], unit, [obstacle]);
  assert.ok(resolved[0] < 1);
  assert.equal(boundsOverlap(worldBounds(unit, resolved), obstacle), false);
});

test('contact blocks penetration while preserving surface sliding', () => {
  const obstacle = worldBounds(unit, [2, 0, 0]);
  const touching = resolveCollisionMove([0, 0, 0], [8, 0, 0], unit, [obstacle]);
  const slid = resolveCollisionMove(touching, [touching[0] + .3, .2, 0], unit, [obstacle]);
  assert.equal(slid[0], touching[0]);
  assert.ok(slid[1] > touching[1]);
  assert.equal(boundsOverlap(worldBounds(unit, slid), obstacle), false);
});
