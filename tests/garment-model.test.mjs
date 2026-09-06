import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garmentFaces, garmentHookAnchors, garmentTopY } from '../src/garment-model.ts';

const base = { width: 1, height: 1, depth: 1, scale: 1 };
const points = (d, roundness = 72, hooks = 0) => garmentFaces(d, roundness, hooks).flatMap((face) => face.points);

for (const [axis, name] of ['width', 'height', 'depth'].entries()) {
  test(`${name} stretches independently for the complete parametric model`, () => {
    const initial = points(base, 72, 2);
    for (const factor of [.1, 2, 5]) {
      const next = points({ ...base, [name]: factor }, 72, 2);
      next.forEach((point, pointIndex) => point.forEach((value, coordinateIndex) => {
        assert.ok(Number.isFinite(value));
        assert.ok(Math.abs(value - initial[pointIndex][coordinateIndex] * (coordinateIndex === axis ? factor : 1)) < 1e-10);
      }));
    }
  });
}

test('roundness continuously lowers the shoulders while preserving the crown', () => {
  assert.equal(garmentTopY(0, 0), .5);
  assert.equal(garmentTopY(0, 100), .5);
  assert.ok(garmentTopY(.45, 100) < garmentTopY(.45, 50));
  assert.ok(garmentTopY(.45, 50) < garmentTopY(.45, 0));
});

test('hooks are optional, countable and attached to the current crown', () => {
  assert.equal(garmentFaces(base, 72).filter((face) => face.material === 'hook').length, 0);
  for (const count of [1, 3, 6]) {
    const anchors = garmentHookAnchors(84, count);
    assert.equal(anchors.length, count);
    anchors.forEach(([x, y]) => assert.equal(y, garmentTopY(x, 84)));
    assert.ok(garmentFaces(base, 84, count).filter((face) => face.material === 'hook').length > 0);
  }
});

test('whole scale scales all axes and geometry stays lightweight', () => {
  const initial = points(base, 72, 0);
  const scaled = points({ width: 5, height: 5, depth: 5, scale: 2 }, 72, 0);
  scaled.forEach((point, pointIndex) => point.forEach((value, coordinateIndex) => assert.ok(Math.abs(value - initial[pointIndex][coordinateIndex] * 10) < 1e-10)));
  assert.ok(garmentFaces(base, 100, 6).length < 800);
});
