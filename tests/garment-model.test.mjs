import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garmentFaces } from '../src/garment-model.ts';

const base = { width: 1, height: 1, depth: 1, scale: 1 };
const points = (d) => garmentFaces(d).flatMap((face) => face.points);
for (const [axis, name] of ['width', 'height', 'depth'].entries()) {
  test(`${name} stretches independently, including zipper and hook`, () => {
    const initial = points(base);
    for (const factor of [.1, 2, 5]) {
      const next = points({ ...base, [name]: factor });
      next.forEach((p, i) => p.forEach((v, j) => {
        assert.ok(Number.isFinite(v));
        assert.ok(Math.abs(v - initial[i][j] * (j === axis ? factor : 1)) < 1e-10);
      }));
    }
  });
}
test('whole scale scales all axes and ground offset supports all dimensions', () => {
  const initial = points(base);
  const scaled = points({ width: 5, height: 5, depth: 5, scale: 2 });
  scaled.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - initial[i][j] * 10) < 1e-10)));
  const lowest = Math.min(...scaled.map((p) => p[1]));
  const groundOffset = -.64 - lowest;
  assert.ok(scaled.every((p) => p[1] + groundOffset >= -.640000001));
  assert.ok(garmentFaces(base).length < 200);
});
