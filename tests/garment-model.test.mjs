import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garmentBottomY, garmentFaces, garmentHookAnchor, garmentTopY } from '../src/garment-model.ts';

const base = { width: 1, height: 1, depth: 1, scale: 1 };
const points = (dimensions, roundness = 72) => garmentFaces(dimensions, roundness).flatMap((face) => face.points);
const bodyPoints = (dimensions, roundness = 72) => garmentFaces(dimensions, roundness).filter((face) => face.material !== 'hook').flatMap((face) => face.points);
const hookPoints = (dimensions, roundness = 72, hookSize = 1) => garmentFaces(dimensions, roundness, true, hookSize).filter((face) => face.material === 'hook').flatMap((face) => face.points);

for (const [axis, name] of [[0, 'width'], [2, 'depth']]) {
  test(`${name} stretches only its own axis`, () => {
    const initial = bodyPoints(base);
    for (const factor of [.1, 2, 5]) {
      const next = bodyPoints({ ...base, [name]: factor });
      next.forEach((point, pointIndex) => point.forEach((value, coordinateIndex) => {
        assert.ok(Number.isFinite(value));
        assert.ok(Math.abs(value - initial[pointIndex][coordinateIndex] * (coordinateIndex === axis ? factor : 1)) < 1e-10);
      }));
    }
  });
}

test('height moves only the lower edge and never stretches the crown or hook', () => {
  const short = points({ ...base, height: .5 });
  const tall = points({ ...base, height: 3 });
  assert.equal(Math.max(...short.map((point) => point[1])), Math.max(...tall.map((point) => point[1])));
  assert.ok(Math.min(...tall.map((point) => point[1])) < Math.min(...short.map((point) => point[1])));
  assert.equal(garmentBottomY(.5), 0);
  assert.equal(garmentBottomY(3), -2.5);
});

test('roundness continuously lowers the shoulders while preserving the crown', () => {
  assert.equal(garmentTopY(0, 0), .5);
  assert.equal(garmentTopY(0, 100), .5);
  assert.ok(garmentTopY(.45, 100) < garmentTopY(.45, 50));
  assert.ok(garmentTopY(.45, 50) < garmentTopY(.45, 0));
});

test('the reference-shaped hook is optional and attaches at the crown centre', () => {
  assert.equal(garmentFaces(base, 72, false).filter((face) => face.material === 'hook').length, 0);
  for (const roundness of [0, 50, 100]) {
    const [x, y] = garmentHookAnchor(roundness);
    assert.equal(x, 0);
    assert.equal(y, garmentTopY(0, roundness));
    assert.ok(garmentFaces(base, roundness, true).filter((face) => face.material === 'hook').length > 150);
  }
  const initial = hookPoints(base);
  for (const dimensions of [{ ...base, width: 4 }, { ...base, height: 4 }, { ...base, depth: 4 }]) {
    assert.deepEqual(hookPoints(dimensions), initial);
  }
});

test('hook size scales independently around the fixed crown attachment', () => {
  const anchorY = garmentHookAnchor(72)[1] * 1.38;
  const small = hookPoints(base, 72, .5);
  const large = hookPoints(base, 72, 2);
  const smallReach = Math.max(...small.map((point) => point[1])) - anchorY;
  const largeReach = Math.max(...large.map((point) => point[1])) - anchorY;
  assert.ok(Math.abs(largeReach / smallReach - 4) < 1e-10);
  assert.deepEqual(bodyPoints(base, 72), garmentFaces(base, 72, true, 2).filter((face) => face.material !== 'hook').flatMap((face) => face.points));
});

test('whole scale scales all axes and geometry stays lightweight', () => {
  const initial = points(base);
  const scaled = points({ ...base, scale: 2 });
  scaled.forEach((point, pointIndex) => point.forEach((value, coordinateIndex) => assert.ok(Math.abs(value - initial[pointIndex][coordinateIndex] * 2) < 1e-10)));
  assert.ok(garmentFaces(base, 100, true).length < 800);
});
