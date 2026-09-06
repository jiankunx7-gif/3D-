import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneInstanceMaterials, decalPercent, normalizedModelColor, scaledDecalDimensions, shadedModelColor, textureSizeFromPercent, updateSurfaceSelection } from '../src/surface-material.ts';

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

test('model colors normalize and preserve predictable surface shading', () => {
  assert.equal(normalizedModelColor(' #A0b1C2 '), '#a0b1c2');
  assert.equal(normalizedModelColor('orange'), '#ee6a35');
  assert.equal(shadedModelColor('#804020', .5), '#402010');
});

test('decal position and independent width or height percentages are constrained', () => {
  assert.equal(decalPercent(42), .42);
  assert.equal(decalPercent(-10), 0);
  assert.equal(decalPercent(240, 5, 200), 2);
  assert.equal(decalPercent(520, 5, 400), 4);
});

test('uniform decal scale preserves the custom width to height ratio', () => {
  const scaled = scaledDecalDimensions(.8, .3, 2.5);
  assert.deepEqual(scaled, { width:2, height:.75 });
  assert.ok(Math.abs(scaled.width / scaled.height - .8 / .3) < 1e-12);
});
