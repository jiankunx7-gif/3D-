import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affineTriangleMap, cubeProjectionUvs, textureWorldPeriod, uvwProjectionUvs } from '../src/texture-projection.ts';

test('cube projection selects the dominant face plane', () => {
  assert.deepEqual(cubeProjectionUvs([[0,0,1],[1,0,1],[1,1,1]]), [[0,0],[1,0],[1,-1]]);
  assert.deepEqual(cubeProjectionUvs([[1,0,0],[1,1,0],[1,1,1]]), [[0,0],[0,-1],[-1,-1]]);
  assert.deepEqual(cubeProjectionUvs([[0,1,0],[0,1,1],[1,1,1]]), [[0,0],[0,1],[1,1]]);
});

test('affine map reproduces all triangle vertices', () => {
  const source = [[0,0],[2,0],[0,3]];
  const target = [[10,20],[30,24],[7,50]];
  const map = affineTriangleMap(source, target);
  assert.ok(map);
  source.forEach(([u,v], index) => {
    assert.ok(Math.abs(map.a*u + map.b*v + map.c - target[index][0]) < 1e-10);
    assert.ok(Math.abs(map.d*u + map.e*v + map.f - target[index][1]) < 1e-10);
  });
});

test('texture size is clamped and grows the cubic tile period', () => {
  assert.equal(textureWorldPeriod(.1), textureWorldPeriod(.25));
  assert.equal(textureWorldPeriod(8), textureWorldPeriod(4));
  assert.equal(textureWorldPeriod(2), textureWorldPeriod(1) * 2);
});

test('UVW projection normalizes planar faces and unwraps curved side seams', () => {
  const bounds = { min:[-1,-1,-1], max:[1,1,1] };
  assert.deepEqual(uvwProjectionUvs([[-1,-1,1],[1,-1,1],[1,1,1]], 'outer-front', bounds), [[0,1],[1,1],[1,0]]);
  const seam = uvwProjectionUvs([[-1,-1,-.01],[-1,-1,.01],[-1,1,.01],[-1,1,-.01]], 'outer-side', bounds);
  assert.ok(Math.max(...seam.map(([u])=>u)) - Math.min(...seam.map(([u])=>u)) < .5);
  assert.deepEqual(seam.map(([,v])=>v), [0,0,1,1]);
});
