import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingContourOnFace, openingContourOnSide, openingContourUv, openingShapeLabel, openingsOverlap, openingSideWallQuads, openingWallQuads } from '../src/garment-openings.ts';

const base = { id:'opening-1', surfaceId:'front', shape:'rectangle', u:.5, v:.55, width:.3, height:.2, scale:1, rotation:0, cornerRadius:.3 };

test('the opening palette contains four shapes and deliberately excludes capsules', () => {
  assert.deepEqual(['rectangle','rounded-rectangle','circle','ellipse'].map(openingShapeLabel), ['矩形','圆角矩形','圆形','椭圆形']);
  assert.equal(openingContourUv(base).length, 4);
  assert.equal(openingContourUv({ ...base, shape:'rounded-rectangle' }).length, 24);
  assert.equal(openingContourUv({ ...base, shape:'circle' }).length, 32);
  assert.equal(openingContourUv({ ...base, shape:'ellipse' }).length, 32);
});

test('position, dimensions, scale and rotation are resolved in normalized face coordinates', () => {
  const face = [[-2,-3,.5],[2,-3,.5],[2,3,.5],[-2,3,.5]];
  const contour = openingContourOnFace(base,face);
  const expected = [[-.6,.3,.5],[.6,.3,.5],[.6,-.9,.5],[-.6,-.9,.5]];
  contour.forEach((point,index) => point.forEach((value,axis) => assert.ok(Math.abs(value-expected[index][axis])<1e-12)));
  const scaled = openingContourUv({ ...base, scale:2 });
  assert.ok(Math.abs((Math.max(...scaled.map(([u])=>u))-Math.min(...scaled.map(([u])=>u)))-.6)<1e-12);
  const rotated = openingContourUv({ ...base, rotation:90 });
  assert.ok(Math.abs((Math.max(...rotated.map(([u])=>u))-Math.min(...rotated.map(([u])=>u)))-.2)<1e-12);
});

test('opening walls connect the visible panel to the inner cavity', () => {
  const face = [[-1,-1,.5],[1,-1,.5],[1,1,.5],[-1,1,.5]];
  const walls = openingWallQuads(base,face,.07);
  assert.equal(walls.length,4);
  assert.equal(walls[0][0][2],.5);
  assert.ok(Math.abs(walls[0][3][2]-.43)<1e-12);
});

test('circle diameter stays physically round on a tall panel', () => {
  const face = [[-1,-3,.5],[1,-3,.5],[1,3,.5],[-1,3,.5]];
  const contour = openingContourOnFace({ ...base, shape:'circle', width:.3 },face);
  const width = Math.max(...contour.map(([x])=>x))-Math.min(...contour.map(([x])=>x));
  const height = Math.max(...contour.map(([,y])=>y))-Math.min(...contour.map(([,y])=>y));
  assert.ok(Math.abs(width-height)<1e-12);
});

test('multiple openings detect overlap only on intersecting bounds', () => {
  assert.equal(openingsOverlap(base,{ ...base,id:'b',u:.6 }),true);
  assert.equal(openingsOverlap(base,{ ...base,id:'c',u:.9 }),false);
});

test('side openings unwrap once around the perimeter and generate inward walls', () => {
  const sideFaces = [
    [[-1,-1,-.4],[1,-1,-.4],[1,-1,.4],[-1,-1,.4]],
    [[1,-1,-.4],[1,1,-.4],[1,1,.4],[1,-1,.4]],
    [[1,1,-.4],[-1,1,-.4],[-1,1,.4],[1,1,.4]],
    [[-1,1,-.4],[-1,-1,-.4],[-1,-1,.4],[-1,1,.4]],
  ];
  const opening = { ...base, surfaceId:'side', u:.375, v:.5, width:.1, height:.2 };
  const contour = openingContourOnSide(opening,sideFaces);
  assert.equal(contour.length,4);
  assert.ok(contour.every((point)=>point.every(Number.isFinite)));
  const { walls,inner } = openingSideWallQuads(opening,sideFaces,.05);
  assert.equal(walls.length,4);
  assert.equal(inner.length,4);
  assert.ok(inner.some((point,index)=>Math.hypot(point[0],point[1])<Math.hypot(contour[index][0],contour[index][1])));
});
