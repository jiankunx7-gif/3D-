import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/shape-studio.tsx', import.meta.url), 'utf8');

test('the workspace starts empty for every model type', () => {
  assert.equal((source.match(/positions: \[\], lidAngles: \[\], crownRoundness: \[\]/g) ?? []).length, 4);
  assert.match(source, /空白工作画布/);
});

test('left palette clicks add models to the shared scene', () => {
  assert.match(source, /onClick=\{\(\) => addShapeInstance\(item\.id\)\}/);
  assert.match(source, /const scene = allSceneFaces\(workspaces\)/);
});

test('the geometry palette includes a procedural front-low back-high trapezoid hat box', () => {
  assert.match(source, /id: "trapezoid" as const, label: "梯形盒"/);
  assert.match(source, /frontTopY=bottomY\+height\*\.62/);
  assert.match(source, /'lid-window'/);
  assert.match(source, /trapezoid: \{ dimensions: \{ width: 5\.6, height: 3\.2, depth: 5, scale: 1 \}/);
});

test('the fixed circular shadow is absent from canvas and JPG rendering', () => {
  assert.doesNotMatch(source, /ctx\.ellipse\(centerX/);
  assert.doesNotMatch(source, /h \* 0\.79/);
});

test('middle mouse pans the view and reset restores the camera centre', () => {
  assert.match(source, /event\.button===1/);
  assert.match(source, /action:'pan'/);
  assert.match(source, /setPan\(\(current\)=>\(\{x:current\.x\+dx,y:current\.y\+dy\}\)\)/);
  assert.match(source, /setPan\(\{ x:0, y:0 \}\)/);
});

test('selected models use a solid colour tint without a circular marquee', () => {
  assert.match(source, /shape === selectedShape && instanceIndex === selectedWorkspace\.selectedIndex/);
  assert.match(source, /rgba\(255,184,112,\.28\)/);
  assert.doesNotMatch(source, /ctx\.arc\(selected\.x/);
});

test('three-view button toggles a four-way perspective and orthographic workspace', () => {
  assert.match(source, /front: \{ label:'正视图'.*axes:'X \/ Y'/);
  assert.match(source, /top: \{ label:'顶视图'.*axes:'X \/ Z'/);
  assert.match(source, /right: \{ label:'右视图'.*axes:'Z \/ Y'/);
  assert.match(source, /canvasProjection === 'orthographic'/);
  assert.match(source, /setThreeViewEnabled\(\(enabled\)=>!enabled\)/);
  assert.match(source, /threeViewEnabled\?'退出三视图':'展开三视图'/);
  assert.match(source, /threeViewEnabled\?'is-quad':'is-single'/);
  assert.match(source, /\(\['front','top','right'\] as OrthographicView\[\]\)/);
});

test('orthographic dragging changes only the two visible axes and keeps collision handling', () => {
  assert.match(source, /view==='front'\?\[horizontal,vertical,0\]:view==='top'\?\[horizontal,0,vertical\]:\[0,vertical,horizontal\]/);
  assert.match(source, /moveInstanceByDelta/);
  assert.match(source, /collisionSafePositionInScene\(targetShape,currentWorkspaces,targetIndex,desired,groundEnabled\)/);
});

test('every model keeps independent dimensions and uniform canvas scale', () => {
  assert.match(source, /instanceDimensions: Dimensions\[\]/);
  assert.match(source, /instanceDimensions:workspace\.instanceDimensions\.map\(\(item,index\)=>index===targetIndex\?nextDimensions:item\)/);
  assert.match(source, /instanceDimensions:\[\.\.\.workspace\.instanceDimensions,newDimensions\]/);
  assert.match(source, /const fit = SHAPE_NORMALIZATION\[shape\]/);
  assert.match(source, /当前模型等比缩放/);
});

test('canvas zoom remains stable and keeps the selected model inside the 1:1 workspace', () => {
  assert.match(source, /const cameraDistance = 4\.25 \* lensRatio/);
  assert.match(source, /focal \* zoom/);
  assert.match(source, /function calculateZoomLimit/);
  assert.match(source, /function clampPanToSquare/);
  assert.match(source, /setGridVisible/);
  assert.match(source, />网格</);
});

test('selected models expose axis gizmos with precise surface picking and camera override controls', () => {
  assert.match(source, /type GizmoAxis = 'x' \| 'y' \| 'z'/);
  assert.match(source, /gizmoHitRegionsRef\.current=axes\.map/);
  assert.match(source, /action:'gizmo'/);
  assert.match(source, /pointer\.axis==='x'/);
  assert.match(source, /faceRegionsRef\.current\]\.reverse\(\)\.find/);
  assert.match(source, /event\.button===2 \|\| \(event\.button===0 && event\.altKey\)/);
  assert.match(source, /onContextMenu=\{\(event\)=>event\.preventDefault\(\)\}/);
});

test('axis gizmos appear only after a direct canvas model click and hide on deselection', () => {
  assert.match(source, /const \[gizmoVisible, setGizmoVisible\] = useState\(false\)/);
  assert.match(source, /gizmoVisible && selectedWorkspace\.positions\.length/);
  assert.match(source, /selectInstance\(faceHit\.shape,faceHit\.instanceIndex\);\s*setGizmoVisible\(true\)/);
  assert.match(source, /const addShapeInstance[\s\S]*?setGizmoVisible\(false\)/);
  assert.match(source, /setGizmoVisible\(false\);\s*pointerRef\.current=\{id:event\.pointerId[\s\S]*?action:'camera'/);
});
