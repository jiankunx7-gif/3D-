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
