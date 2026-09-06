import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneInstanceMaterials, textureSizeFromPercent, updateSurfaceSelection } from '../src/surface-material.ts';

test('ordinary click replaces selection and shift click toggles surfaces', () => {
  assert.deepEqual(updateSurfaceSelection(['front'], 'back', false), ['back']);
  assert.deepEqual(updateSurfaceSelection(['front'], 'back', true), ['front','back']);
  assert.deepEqual(updateSurfaceSelection(['front','back'], 'front', true), ['back']);
});

test('typed texture size is converted and constrained to the supported range', () => {
  assert.equal(textureSizeFromPercent(25), .25);
  assert.equal(textureSizeFromPercent(137), 1.37);
  assert.equal(textureSizeFromPercent(999), 4);
  assert.equal(textureSizeFromPercent(Number.NaN), .25);
});

test('material-bearing instances clone every assigned surface', () => {
  const material = { name:'linen', projection:'uvw' };
  const next = cloneInstanceMaterials({ '0:front':material, '0:side':material, '1:front':{ name:'wood' } }, 0, 2);
  assert.deepEqual(next['2:front'], material);
  assert.deepEqual(next['2:side'], material);
  assert.equal(next['2:back'], undefined);
});
