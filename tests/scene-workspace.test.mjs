import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/shape-studio.tsx', import.meta.url), 'utf8');

test('the workspace starts empty for every model type', () => {
  assert.equal((source.match(/positions: \[\], lidAngles: \[\], crownRoundness: \[\]/g) ?? []).length, 3);
  assert.match(source, /空白工作画布/);
});

test('left palette clicks add models to the shared scene', () => {
  assert.match(source, /onClick=\{\(\) => addShapeInstance\(item\.id\)\}/);
  assert.match(source, /const scene = allSceneFaces\(workspaces\)/);
});

test('the fixed circular shadow is absent from canvas and JPG rendering', () => {
  assert.doesNotMatch(source, /ctx\.ellipse\(centerX/);
  assert.doesNotMatch(source, /h \* 0\.79/);
});

test('middle mouse pans the view and reset restores the camera centre', () => {
  assert.match(source, /e\.button===1/);
  assert.match(source, /action:"pan"/);
  assert.match(source, /setPan\(\(current\)=>\(\{x:current\.x\+dx,y:current\.y\+dy\}\)\)/);
  assert.match(source, /setPan\(\{ x:0, y:0 \}\)/);
});

test('selected models use a solid colour tint without a circular marquee', () => {
  assert.match(source, /shape === selectedShape && instanceIndex === selectedWorkspace\.selectedIndex/);
  assert.match(source, /rgba\(255,184,112,\.28\)/);
  assert.doesNotMatch(source, /ctx\.arc\(selected\.x/);
});
