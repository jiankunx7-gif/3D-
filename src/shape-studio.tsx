"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Camera, Circle, Copy, Cylinder, DoorOpen, Download, Grid3X3, ImageIcon, Link2, LocateFixed, Maximize2, Minus, MousePointer2, Move3D, Palette, Plus, Redo2, Rotate3D, Shirt, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { garmentFaces } from './garment-model';
import { boundsOverlap, resolveCollisionMove, spawnBeside, worldBounds, type CollisionBounds } from './collision';
import { affineTriangleMap, cubeProjectionUvs, textureWorldPeriod, uvwProjectionUvs, type ProjectionBounds } from './texture-projection';
import { cloneInstanceMaterials, decalPercent, normalizedModelColor, shadedModelColor, textureSizeFromPercent, updateSurfaceSelection } from './surface-material';

type ShapeType = "box" | "cylinder" | "garment";
type Dimensions = { width: number; height: number; depth: number; scale: number };
type Vec3 = [number, number, number];
type ProjectionMode = 'cube' | 'uvw';
type TextureMaterial = { src: string; name: string; size: number; projection: ProjectionMode };
type Decal = { src: string; name: string; u: number; v: number; size: number };
type ShapeWorkspace = { dimensions: Dimensions; positions: Vec3[]; lidAngles: number[]; crownRoundness: number[]; hookEnabled: boolean[]; hookSizes: number[]; colors: string[]; selectedIndex: number; selectedSurfaceIds: string[]; faceMaterials: Record<string, TextureMaterial>; decals: Record<string, Decal> };
type SceneFace = { points: Vec3[]; material: "body" | "lid" | "inside" | "trim" | "hook"; surfaceId: string };
type InstanceFace = SceneFace & { instanceIndex: number; localPoints: Vec3[] };
type HitRegion = { index: number; x: number; y: number; radius: number };
type FaceHitRegion = { instanceIndex: number; surfaceId: string; polygon: { x: number; y: number }[] };
const GROUND_Y = -0.64;
const MIN_ZOOM = 0.62;
const MAX_ZOOM_SEARCH = 6;
const CANVAS_EDGE_PADDING = 12;

const SHAPES = [
  { id: "box" as const, label: "长方体", icon: Box },
  { id: "cylinder" as const, label: "圆柱体", icon: Cylinder },
  { id: "garment" as const, label: "西服套", icon: Shirt },
];

function hingeRotate([x, y, z]: Vec3, hingeY: number, hingeZ: number, angle: number): Vec3 {
  const dy = y - hingeY, dz = z - hingeZ;
  const c = Math.cos(-angle), s = Math.sin(-angle);
  return [x, hingeY + dy * c - dz * s, hingeZ + dy * s + dz * c];
}

function garmentSurfaceId(faceIndex: number) {
  if (faceIndex === 0) return 'back';
  if (faceIndex === 1) return 'front';
  if (faceIndex <= 28) return 'front-trim';
  if (faceIndex <= 55) return 'side';
  if (faceIndex <= 82) return 'back-trim';
  return 'hook';
}

function sceneFaces(shape: ShapeType, dimensions: Dimensions, lidAngle: number, roundness = 72, hookEnabled = false, hookSize = 1): SceneFace[] {
  if (shape === 'garment') return garmentFaces(dimensions, roundness, hookEnabled, hookSize).map((face, faceIndex) => ({ ...face, surfaceId: garmentSurfaceId(faceIndex) }));
  const width = dimensions.width * dimensions.scale;
  const height = dimensions.height * dimensions.scale;
  const depth = dimensions.depth * dimensions.scale;
  const thickness = Math.min(Math.max(.025, Math.min(width, depth) * .045), width * .22, depth * .22, height * .22);
  const angle = (lidAngle * Math.PI) / 180;
  const hingeY = height / 2;
  const hingeZ = -depth / 2;
  const bottomY = -height / 2;
  const faces: SceneFace[] = [];

  if (shape === "box") {
    const x0 = -width/2, x1 = width/2, z0 = -depth/2, z1 = depth/2;
    const ix0 = x0 + thickness, ix1 = x1 - thickness, iz0 = z0 + thickness, iz1 = z1 - thickness;
    const innerBottomY = bottomY + thickness;
    faces.push(
      { material:'body', surfaceId:'outer-back', points:[[x0,bottomY,z0],[x0,hingeY,z0],[x1,hingeY,z0],[x1,bottomY,z0]] },
      { material:'body', surfaceId:'outer-front', points:[[x0,bottomY,z1],[x1,bottomY,z1],[x1,hingeY,z1],[x0,hingeY,z1]] },
      { material:'body', surfaceId:'outer-left', points:[[x0,bottomY,z0],[x0,bottomY,z1],[x0,hingeY,z1],[x0,hingeY,z0]] },
      { material:'body', surfaceId:'outer-right', points:[[x1,bottomY,z0],[x1,hingeY,z0],[x1,hingeY,z1],[x1,bottomY,z1]] },
      { material:'body', surfaceId:'outer-bottom', points:[[x0,bottomY,z0],[x1,bottomY,z0],[x1,bottomY,z1],[x0,bottomY,z1]] },
      { material:'trim', surfaceId:'rim', points:[[x0,hingeY,z0],[x1,hingeY,z0],[ix1,hingeY,iz0],[ix0,hingeY,iz0]] },
      { material:'trim', surfaceId:'rim', points:[[x0,hingeY,z1],[ix0,hingeY,iz1],[ix1,hingeY,iz1],[x1,hingeY,z1]] },
      { material:'trim', surfaceId:'rim', points:[[x0,hingeY,z0],[ix0,hingeY,iz0],[ix0,hingeY,iz1],[x0,hingeY,z1]] },
      { material:'trim', surfaceId:'rim', points:[[x1,hingeY,z0],[x1,hingeY,z1],[ix1,hingeY,iz1],[ix1,hingeY,iz0]] },
      { material:'inside', surfaceId:'inside-back', points:[[ix0,innerBottomY,iz0],[ix1,innerBottomY,iz0],[ix1,hingeY,iz0],[ix0,hingeY,iz0]] },
      { material:'inside', surfaceId:'inside-front', points:[[ix0,innerBottomY,iz1],[ix0,hingeY,iz1],[ix1,hingeY,iz1],[ix1,innerBottomY,iz1]] },
      { material:'inside', surfaceId:'inside-left', points:[[ix0,innerBottomY,iz0],[ix0,hingeY,iz0],[ix0,hingeY,iz1],[ix0,innerBottomY,iz1]] },
      { material:'inside', surfaceId:'inside-right', points:[[ix1,innerBottomY,iz0],[ix1,innerBottomY,iz1],[ix1,hingeY,iz1],[ix1,hingeY,iz0]] },
      { material:'inside', surfaceId:'inside-bottom', points:[[ix0,innerBottomY,iz0],[ix0,innerBottomY,iz1],[ix1,innerBottomY,iz1],[ix1,innerBottomY,iz0]] },
    );
    const lidVertices: Vec3[] = [
      [-width/2, hingeY, -depth/2], [width/2, hingeY, -depth/2], [width/2, hingeY, depth/2], [-width/2, hingeY, depth/2],
      [-width/2, hingeY + thickness, -depth/2], [width/2, hingeY + thickness, -depth/2], [width/2, hingeY + thickness, depth/2], [-width/2, hingeY + thickness, depth/2],
    ].map((point) => hingeRotate(point as Vec3, hingeY, hingeZ, angle));
    const lidFaces = [
      { indices:[0,3,2,1], surfaceId:'lid-inner' }, { indices:[4,5,6,7], surfaceId:'lid-outer' },
      { indices:[0,1,5,4], surfaceId:'lid-back-edge' }, { indices:[3,7,6,2], surfaceId:'lid-front-edge' },
      { indices:[0,4,7,3], surfaceId:'lid-left-edge' }, { indices:[1,2,6,5], surfaceId:'lid-right-edge' },
    ];
    lidFaces.forEach(({ indices, surfaceId }) => {
      faces.push({ material: "lid", surfaceId, points: indices.map((index) => lidVertices[index]) });
    });
  } else {
    const segments = 28;
    const outerBottom = Array.from({ length: segments }, (_, i) => {
      const theta = (i / segments) * Math.PI * 2;
      return [Math.cos(theta) * width/2, bottomY, Math.sin(theta) * depth/2] as Vec3;
    });
    const outerTop = outerBottom.map(([x,,z]) => [x,hingeY,z] as Vec3);
    const innerBottomY = bottomY + thickness;
    const innerTop = Array.from({ length: segments }, (_, i) => {
      const theta = (i / segments) * Math.PI * 2;
      return [Math.cos(theta) * Math.max(.02,width/2-thickness), hingeY, Math.sin(theta) * Math.max(.02,depth/2-thickness)] as Vec3;
    });
    const innerBottom = innerTop.map(([x,,z]) => [x,innerBottomY,z] as Vec3);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push(
        { material:'body', surfaceId:'outer-side', points:[outerBottom[i],outerBottom[next],outerTop[next],outerTop[i]] },
        { material:'trim', surfaceId:'rim', points:[outerTop[i],outerTop[next],innerTop[next],innerTop[i]] },
        { material:'inside', surfaceId:'inside-side', points:[innerBottom[i],innerTop[i],innerTop[next],innerBottom[next]] },
      );
    }
    faces.push(
      { material:'body', surfaceId:'outer-bottom', points:[...outerBottom].reverse() },
      { material:'inside', surfaceId:'inside-bottom', points:innerBottom },
    );
    const lower = outerTop.map((point) => hingeRotate(point, hingeY, hingeZ, angle));
    const upper = outerTop.map(([x,,z]) => hingeRotate([x, hingeY + thickness, z], hingeY, hingeZ, angle));
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push({ material: "lid", surfaceId:'lid-edge', points: [lower[i], lower[next], upper[next], upper[i]] });
    }
    faces.push({ material: "lid", surfaceId:'lid-inner', points: [...lower].reverse() });
    faces.push({ material: "lid", surfaceId:'lid-outer', points: upper });
  }
  return faces;
}

function positionedSceneFaces(shape: ShapeType, dimensions: Dimensions, lidAngles: number[], crownRoundness: number[], hookEnabled: boolean[], hookSizes: number[], positions: Vec3[]): InstanceFace[] {
  const fit = shape === 'garment' ? 1 : Math.max(dimensions.width * dimensions.scale, dimensions.height * dimensions.scale, dimensions.depth * dimensions.scale, .1);
  return positions.flatMap(([offsetX, offsetY, offsetZ], instanceIndex) =>
    sceneFaces(shape, dimensions, lidAngles[instanceIndex] ?? 0, crownRoundness[instanceIndex] ?? 72, hookEnabled[instanceIndex] ?? false, hookSizes[instanceIndex] ?? 1).map(({ points, material, surfaceId }) => ({
      material,
      surfaceId,
      instanceIndex,
      localPoints: points.map(([x,y,z]) => [x / fit, y / fit, z / fit] as Vec3),
      points: points.map(([x,y,z]) => [x / fit + offsetX, y / fit + offsetY, z / fit + offsetZ] as Vec3),
    }))
  );
}

function groundOffsetFor(shape: ShapeType, dimensions: Dimensions, lidAngle: number) {
  const fit = shape === 'garment' ? 1 : Math.max(dimensions.width * dimensions.scale, dimensions.height * dimensions.scale, dimensions.depth * dimensions.scale, .1);
  const lowestPoint = Math.min(...sceneFaces(shape, dimensions, lidAngle).flatMap((face) => face.points.map((point) => point[1]))) / fit;
  return GROUND_Y - lowestPoint;
}

function localBoundsFor(shape: ShapeType, dimensions: Dimensions, lidAngle: number, roundness: number, hookEnabled: boolean, hookSize = 1): CollisionBounds {
  const fit = shape === 'garment' ? 1 : Math.max(dimensions.width * dimensions.scale, dimensions.height * dimensions.scale, dimensions.depth * dimensions.scale, .1);
  const points = sceneFaces(shape, dimensions, lidAngle, roundness, hookEnabled, hookSize).flatMap((face) => face.points);
  return {
    min: ([0, 1, 2] as const).map((axis) => Math.min(...points.map((point) => point[axis])) / fit) as Vec3,
    max: ([0, 1, 2] as const).map((axis) => Math.max(...points.map((point) => point[axis])) / fit) as Vec3,
  };
}

function collisionSafePosition(shape: ShapeType, workspace: ShapeWorkspace, index: number, desiredPosition: Vec3, groundEnabled: boolean) {
  const current = workspace.positions[index] ?? [0, 0, 0];
  const desired = [...desiredPosition] as Vec3;
  if (groundEnabled) desired[1] = Math.max(desired[1], groundOffsetFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0));
  const movingBounds = localBoundsFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0, workspace.crownRoundness[index] ?? 72, workspace.hookEnabled[index] ?? false, workspace.hookSizes[index] ?? 1);
  const obstacles = workspace.positions.flatMap((position, obstacleIndex) => obstacleIndex === index ? [] : [worldBounds(
    localBoundsFor(shape, workspace.dimensions, workspace.lidAngles[obstacleIndex] ?? 0, workspace.crownRoundness[obstacleIndex] ?? 72, workspace.hookEnabled[obstacleIndex] ?? false, workspace.hookSizes[obstacleIndex] ?? 1),
    position,
  )]);
  return resolveCollisionMove(current, desired, movingBounds, obstacles) as Vec3;
}

function separateOverlappingInstances(shape: ShapeType, workspace: ShapeWorkspace, groundEnabled: boolean): ShapeWorkspace {
  const placedBounds: CollisionBounds[] = [];
  const positions = workspace.positions.map((position, index) => {
    const localBounds = localBoundsFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0, workspace.crownRoundness[index] ?? 72, workspace.hookEnabled[index] ?? false, workspace.hookSizes[index] ?? 1);
    const groundY = groundEnabled ? groundOffsetFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0) : position[1];
    let nextPosition = [position[0], Math.max(position[1], groundY), position[2]] as Vec3;
    if (placedBounds.some((bounds) => boundsOverlap(worldBounds(localBounds, nextPosition), bounds))) {
      nextPosition = spawnBeside(localBounds, placedBounds, groundY, position[2]) as Vec3;
    }
    placedBounds.push(worldBounds(localBounds, nextPosition));
    return nextPosition;
  });
  return { ...workspace, positions };
}

function rotate([x, y, z]: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

function inverseRotate([x, y, z]: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const y1 = y * cp + z * sp;
  const z1 = -y * sp + z * cp;
  return [x * cy - z1 * sy, y1, x * sy + z1 * cy];
}

function calculateZoomLimit(shape: ShapeType, dimensions: Dimensions, rotation: { yaw: number; pitch: number }, focalLength: number, lidAngles: number[], crownRoundness: number[], hookEnabled: boolean[], hookSizes: number[], positions: Vec3[], width: number, height: number) {
  if (width <= 0 || height <= 0) return 1.72;
  const points = positionedSceneFaces(shape, dimensions, lidAngles, crownRoundness, hookEnabled, hookSizes, positions)
    .flatMap((face) => face.points)
    .map((point) => rotate(point, rotation.yaw, rotation.pitch));
  if (!points.length) return 1.72;
  const lensRatio = focalLength / 35;
  const focal = Math.min(width, height) * 1.75 * lensRatio;
  const centerX = width / 2;
  const centerY = height / 2 - 5;
  const fits = (candidate: number) => {
    const cameraDistance = (4.25 * lensRatio) / candidate;
    return points.every((point) => {
      const denominator = cameraDistance - point[2];
      if (denominator <= 1.2) return false;
      const x = centerX + (point[0] * focal) / denominator;
      const y = centerY - (point[1] * focal) / denominator;
      return x >= CANVAS_EDGE_PADDING && x <= width - CANVAS_EDGE_PADDING && y >= CANVAS_EDGE_PADDING && y <= height - CANVAS_EDGE_PADDING;
    });
  };
  if (!fits(.03)) return .03;
  let low = .03;
  let high = MAX_ZOOM_SEARCH;
  for (let index = 0; index < 26; index++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.max(.03, Math.min(MAX_ZOOM_SEARCH, low));
}

const textureImages = new Map<string, HTMLImageElement>();
const faceMaterialKey = (instanceIndex: number, surfaceId: string) => `${instanceIndex}:${surfaceId}`;
function surfaceLabel(shape: ShapeType, surfaceId: string | null) {
  if (!surfaceId) return '未选面';
  const common: Record<string,string> = {
    'outer-back':'外侧后面', 'outer-front':'外侧正面', 'outer-left':'外侧左面', 'outer-right':'外侧右面', 'outer-bottom':'外侧底面',
    'inside-back':'内壁后面', 'inside-front':'内壁正面', 'inside-left':'内壁左面', 'inside-right':'内壁右面', 'inside-side':'内部侧壁', 'inside-bottom':'内部底面',
    rim:'开口包边', 'outer-side':'圆柱侧面', 'lid-inner':'盖面内侧', 'lid-outer':'盖面外侧', 'lid-edge':'盖面侧边',
    'lid-back-edge':'盖面后边', 'lid-front-edge':'盖面前边', 'lid-left-edge':'盖面左边', 'lid-right-edge':'盖面右边',
    back:'背面', front:'正面', 'front-trim':'前侧包边', side:'侧围', 'back-trim':'后侧包边', hook:'挂钩表面',
  };
  return common[surfaceId] ?? (shape === 'cylinder' ? '圆柱表面' : '模型表面');
}

function textureImage(src: string, onLoad: () => void) {
  let image = textureImages.get(src);
  if (!image) {
    image = new Image();
    image.src = src;
    textureImages.set(src, image);
  }
  if (!image.complete || !image.naturalWidth) {
    image.addEventListener('load', onLoad, { once: true });
    return null;
  }
  return image;
}

function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function fillProjectedTexture(ctx: CanvasRenderingContext2D, pattern: CanvasPattern, image: HTMLImageElement, localPoints: Vec3[], projected: { x: number; y: number }[], material: TextureMaterial, surfaceId: string, bounds: ProjectionBounds) {
  if (localPoints.length < 3 || projected.length < 3) return;
  const uvs = material.projection === 'uvw'
    ? uvwProjectionUvs(localPoints, surfaceId, bounds).map(([u,v]) => [u / material.size * image.naturalWidth, v / material.size * image.naturalHeight] as [number,number])
    : cubeProjectionUvs(localPoints).map(([u,v]) => { const period=textureWorldPeriod(material.size); return [u / period * image.naturalWidth, v / period * image.naturalHeight] as [number,number]; });
  for (let index = 1; index < localPoints.length - 1; index++) {
    const source = [uvs[0], uvs[index], uvs[index + 1]] as [[number,number],[number,number],[number,number]];
    const target = [[projected[0].x, projected[0].y], [projected[index].x, projected[index].y], [projected[index + 1].x, projected[index + 1].y]] as [[number,number],[number,number],[number,number]];
    const map = affineTriangleMap(source, target);
    if (!map) continue;
    pattern.setTransform(new DOMMatrix([map.a, map.d, map.b, map.e, map.c, map.f]));
    ctx.beginPath();
    target.forEach(([x,y], pointIndex) => pointIndex === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    ctx.closePath();
    ctx.fillStyle = pattern;
    ctx.fill();
  }
}

function fillProjectedDecal(ctx: CanvasRenderingContext2D, image: HTMLImageElement, localPoints: Vec3[], projected: { x: number; y: number }[], decal: Decal, surfaceId: string, bounds: ProjectionBounds) {
  if (localPoints.length < 3 || projected.length < 3 || !image.naturalWidth || !image.naturalHeight) return;
  const uvs = uvwProjectionUvs(localPoints, surfaceId, bounds);
  const width = Math.max(.05, decal.size);
  const height = width * image.naturalHeight / image.naturalWidth;
  const left = decal.u - width / 2;
  const top = decal.v - height / 2;
  const horizontalCopies = surfaceId.includes('side') || surfaceId.includes('edge') ? [left - 1, left, left + 1] : [left];
  for (let index = 1; index < localPoints.length - 1; index++) {
    const source = [uvs[0], uvs[index], uvs[index + 1]] as [[number,number],[number,number],[number,number]];
    const target = [[projected[0].x, projected[0].y], [projected[index].x, projected[index].y], [projected[index + 1].x, projected[index + 1].y]] as [[number,number],[number,number],[number,number]];
    const map = affineTriangleMap(source, target);
    if (!map) continue;
    ctx.save();
    ctx.beginPath();
    target.forEach(([x,y], pointIndex) => pointIndex === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    ctx.closePath();
    ctx.clip();
    ctx.transform(map.a, map.d, map.b, map.e, map.c, map.f);
    horizontalCopies.forEach((copyLeft) => ctx.drawImage(image, copyLeft, top, width, height));
    ctx.restore();
  }
}

function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>, hitRegionsRef: React.MutableRefObject<HitRegion[]>, faceRegionsRef: React.MutableRefObject<FaceHitRegion[]>, drawSceneRef: React.MutableRefObject<((cleanCapture?: boolean) => void) | null>, shape: ShapeType, dimensions: Dimensions, rotation: { yaw: number; pitch: number }, zoom: number, gridVisible: boolean, groundEnabled: boolean, focalLength: number, lidAngles: number[], crownRoundness: number[], hookEnabled: boolean[], hookSizes: number[], positions: Vec3[], colors: string[], selectedIndex: number, selectedSurfaceIds: string[], faceMaterials: Record<string, TextureMaterial>, decals: Record<string, Decal>, materialPickerEnabled: boolean) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const draw = (cleanCapture = false) => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height;
      ctx.clearRect(0, 0, w, h);
      const background = ctx.createRadialGradient(w * .52, h * .4, 12, w * .52, h * .4, Math.max(w,h) * .72);
      background.addColorStop(0, "#ffffff"); background.addColorStop(.48, "#f7f8f9"); background.addColorStop(1, "#eef1f3");
      ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
      const scene = positionedSceneFaces(shape, dimensions, lidAngles, crownRoundness, hookEnabled, hookSizes, positions);
      const lensRatio = focalLength / 35;
      const cameraDistance = (4.25 * lensRatio) / zoom;
      const focal = Math.min(w, h) * 1.75 * lensRatio;
      const centerX = w / 2, centerY = h / 2 - 5;
      const project = (v: Vec3) => {
        const denominator = Math.max(1.2, cameraDistance - v[2]);
        return { x: centerX + (v[0] * focal) / denominator, y: centerY - (v[1] * focal) / denominator, z: v[2] };
      };
      if (groundEnabled) {
        const ground = [[-4.5, GROUND_Y, -4.5], [4.5, GROUND_Y, -4.5], [4.5, GROUND_Y, 4.5], [-4.5, GROUND_Y, 4.5]] as Vec3[];
        const projectedGround = ground.map((point) => project(rotate(point, rotation.yaw, rotation.pitch)));
        ctx.beginPath();
        projectedGround.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
        ctx.closePath();
        ctx.fillStyle = "rgba(218,223,227,.7)";
        ctx.fill();
        ctx.strokeStyle = "rgba(143,153,164,.34)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (gridVisible && !cleanCapture) {
        const gridSize = 2.25;
        const gridY = GROUND_Y;
        ctx.lineWidth = 1;
        for (let i = -8; i <= 8; i++) {
          const a = project(rotate([(i / 8) * gridSize, gridY, -gridSize], rotation.yaw, rotation.pitch));
          const b = project(rotate([(i / 8) * gridSize, gridY, gridSize], rotation.yaw, rotation.pitch));
          const c = project(rotate([-gridSize, gridY, (i / 8) * gridSize], rotation.yaw, rotation.pitch));
          const d = project(rotate([gridSize, gridY, (i / 8) * gridSize], rotation.yaw, rotation.pitch));
          ctx.strokeStyle = i === 0 ? "rgba(241,106,52,.28)" : "rgba(130,144,160,.13)";
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
        }
      }
      const light: Vec3 = [-0.35, 0.8, 0.55];
      const instanceProjected: { x: number; y: number }[][] = Array.from({ length: positions.length }, () => []);
      const localBoundsByInstance = scene.reduce((bounds, face) => {
        const current = bounds[face.instanceIndex] ?? { min:[Infinity,Infinity,Infinity] as Vec3, max:[-Infinity,-Infinity,-Infinity] as Vec3 };
        face.localPoints.forEach((point) => point.forEach((value, axis) => { current.min[axis] = Math.min(current.min[axis], value); current.max[axis] = Math.max(current.max[axis], value); }));
        bounds[face.instanceIndex] = current;
        return bounds;
      }, [] as ProjectionBounds[]);
      const visibleFaces = scene.map(({ points, localPoints, material, instanceIndex, surfaceId }) => {
        const transformed = points.map((point) => rotate(point, rotation.yaw, rotation.pitch));
        const projected = transformed.map(project);
        instanceProjected[instanceIndex].push(...projected);
        const p0 = transformed[0], p1 = transformed[1], p2 = transformed[2];
        const u: Vec3 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        const v: Vec3 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        const normal: Vec3 = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const length = Math.hypot(...normal) || 1;
        const shade = Math.max(0, (normal[0]*light[0] + normal[1]*light[1] + normal[2]*light[2]) / length);
        return { projected, localPoints, depth: transformed.reduce((sum, point) => sum + point[2], 0) / transformed.length, shade, material, instanceIndex, surfaceId };
      }).sort((a, b) => a.depth - b.depth);
      ctx.lineJoin = "round";
      const patternCache = new Map<string, { image: HTMLImageElement; pattern: CanvasPattern }>();
      for (const { projected, localPoints, shade, material, instanceIndex, surfaceId } of visibleFaces) {
        const assignedMaterial = faceMaterials[faceMaterialKey(instanceIndex, surfaceId)];
        const assignedDecal = decals[faceMaterialKey(instanceIndex, surfaceId)];
        const image = assignedMaterial ? textureImage(assignedMaterial.src, draw) : null;
        const decalImage = assignedDecal ? textureImage(assignedDecal.src, draw) : null;
        const modelColor = colors[instanceIndex] ?? '#ee6a35';
        ctx.beginPath();
        projected.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        if (assignedMaterial && image) {
          let cached = patternCache.get(assignedMaterial.src);
          if (!cached) {
            const pattern = ctx.createPattern(image, 'repeat');
            if (pattern) { cached = { image, pattern }; patternCache.set(assignedMaterial.src, cached); }
          }
          if (cached) fillProjectedTexture(ctx, cached.pattern, cached.image, localPoints, projected, assignedMaterial, surfaceId, localBoundsByInstance[instanceIndex]);
          ctx.beginPath();
          projected.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
          ctx.closePath();
          ctx.fillStyle = `rgba(16,23,31,${Math.max(.04, .2 - shade * .13)})`;
          ctx.fill();
        } else {
          ctx.fillStyle = material === "hook" ? `hsl(215 9% ${34 + shade * 42}%)` : material === "trim" ? shadedModelColor(modelColor, .67 + shade * .28) : material === "inside" ? shadedModelColor(modelColor, .32 + shade * .12) : material === "lid" ? shadedModelColor(modelColor, .82 + shade * .28) : shadedModelColor(modelColor, .7 + shade * .32);
          ctx.fill();
        }
        if (assignedDecal && decalImage) {
          fillProjectedDecal(ctx, decalImage, localPoints, projected, assignedDecal, surfaceId, localBoundsByInstance[instanceIndex]);
          ctx.beginPath();
          projected.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
          ctx.closePath();
        }
        ctx.strokeStyle = material === "inside" ? "rgba(255,255,255,.08)" : material === "hook" ? "rgba(24,33,45,.48)" : material === "lid" ? "rgba(90,34,12,.38)" : "rgba(68,28,12,.22)";
        ctx.lineWidth = material === "lid" ? 1 : .75;
        ctx.stroke();
        if (!cleanCapture && materialPickerEnabled && instanceIndex === selectedIndex && selectedSurfaceIds.includes(surfaceId)) {
          ctx.fillStyle = "rgba(238,106,53,.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(217,81,29,.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      faceRegionsRef.current = visibleFaces.map(({ instanceIndex, surfaceId, projected }) => ({ instanceIndex, surfaceId, polygon: projected }));
      const regions = instanceProjected.map((points, index) => {
        const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
        return { index, x: (left + right) / 2, y: (top + bottom) / 2, radius: Math.max(26, Math.hypot(right-left, bottom-top) / 2) };
      });
      hitRegionsRef.current = regions;
      const selected = regions[selectedIndex];
      if (selected && !cleanCapture) {
        ctx.save();
        ctx.strokeStyle = "rgba(238,106,53,.9)";
        ctx.fillStyle = "rgba(255,255,255,.94)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(selected.x, selected.y, selected.radius + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "700 10px Arial";
        const label = `形体 ${selectedIndex + 1}`;
        const labelWidth = ctx.measureText(label).width + 16;
        ctx.fillRect(selected.x - labelWidth/2, selected.y - selected.radius - 27, labelWidth, 20);
        ctx.strokeRect(selected.x - labelWidth/2, selected.y - selected.radius - 27, labelWidth, 20);
        ctx.fillStyle = "#d9511d";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, selected.x, selected.y - selected.radius - 17);
        ctx.restore();
      }
      if (!groundEnabled) {
        const glow = ctx.createRadialGradient(centerX, h * 0.79, 8, centerX, h * 0.79, Math.min(w,h) * 0.28);
        glow.addColorStop(0, "rgba(19,27,37,.12)"); glow.addColorStop(1, "rgba(19,27,37,0)");
        ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(centerX, h*.79, Math.min(w,h)*.28, Math.min(w,h)*.075, 0, 0, Math.PI*2); ctx.fill();
      }
    };
    drawSceneRef.current = draw;
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => { observer.disconnect(); drawSceneRef.current = null; };
  }, [canvasRef, hitRegionsRef, faceRegionsRef, drawSceneRef, shape, dimensions, rotation, zoom, gridVisible, groundEnabled, focalLength, lidAngles, crownRoundness, hookEnabled, hookSizes, positions, colors, selectedIndex, selectedSurfaceIds, faceMaterials, decals, materialPickerEnabled]);
}

function DimensionControl({ label, axis, value, unit, minValue, maxValue, onChange }: { label: string; axis: string; value: number; unit: string; minValue?: number; maxValue?: number; onChange: (value: number) => void }) {
  const min = minValue ?? (unit === "%" ? 10 : .5), max = maxValue ?? (unit === "%" ? 500 : 10), step = unit === "%" ? 1 : .1;
  return <div className="dimension-control">
    <div className="control-heading"><span><b className={`axis axis-${axis.toLowerCase()}`}>{axis}</b>{label}</span><label className="value-field"><input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} /><span>{unit}</span></label></div>
    <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)} />
  </div>;
}

export default function ShapeStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const faceRegionsRef = useRef<FaceHitRegion[]>([]);
  const drawSceneRef = useRef<((cleanCapture?: boolean) => void) | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; action: "object" | "camera"; objectIndex: number } | null>(null);
  const lidAnimationRef = useRef<number | null>(null);
  const [shape, setShape] = useState<ShapeType>("garment");
  const isGarment = shape === "garment";
  const [workspaces, setWorkspaces] = useState<Record<ShapeType, ShapeWorkspace>>({
    garment: { dimensions: { width: 1, height: 1, depth: 1, scale: 1 }, positions: [[0, 0, 0]], lidAngles: [0], crownRoundness: [72], hookEnabled: [false], hookSizes: [1], colors: ['#ee6a35'], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {} },
    box: { dimensions: { width: 4, height: 3, depth: 2.5, scale: 1 }, positions: [[0, 0, 0]], lidAngles: [0], crownRoundness: [0], hookEnabled: [false], hookSizes: [1], colors: ['#ee6a35'], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {} },
    cylinder: { dimensions: { width: 3, height: 4, depth: 3, scale: 1 }, positions: [[0, 0, 0]], lidAngles: [0], crownRoundness: [0], hookEnabled: [false], hookSizes: [1], colors: ['#ee6a35'], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {} },
  });
  const [rotation, setRotation] = useState({ yaw: -.62, pitch: -.38 });
  const [zoom, setZoom] = useState(1);
  const [zoomLimit, setZoomLimit] = useState(1.72);
  const [gridVisible, setGridVisible] = useState(true);
  const [groundEnabled, setGroundEnabled] = useState(false);
  const [focalLength, setFocalLength] = useState(35);
  const [captureStatus, setCaptureStatus] = useState(false);
  const [materialPickerEnabled, setMaterialPickerEnabled] = useState(false);
  const [newMaterialProjection, setNewMaterialProjection] = useState<ProjectionMode>('cube');
  const { dimensions, positions, lidAngles, crownRoundness, hookEnabled, hookSizes, colors, selectedIndex, selectedSurfaceIds, faceMaterials, decals } = workspaces[shape];
  const quantity = positions.length;
  const dimensionLabel = (value: number) => isGarment ? `${Math.round(value * 100)}%` : `${value.toFixed(1)} cm`;
  const selectedLidAngle = lidAngles[selectedIndex] ?? 0;
  const selectedRoundness = crownRoundness[selectedIndex] ?? 72;
  const selectedHookEnabled = hookEnabled[selectedIndex] ?? false;
  const selectedHookSize = hookSizes[selectedIndex] ?? 1;
  const selectedColor = colors[selectedIndex] ?? '#ee6a35';
  const primarySurfaceId = selectedSurfaceIds[0] ?? null;
  const selectedFaceMaterial = primarySurfaceId ? faceMaterials[faceMaterialKey(selectedIndex, primarySurfaceId)] ?? null : null;
  const selectedDecal = primarySurfaceId ? decals[faceMaterialKey(selectedIndex, primarySurfaceId)] ?? null : null;
  const selectedProjection = selectedFaceMaterial?.projection ?? newMaterialProjection;
  const groundMinY = groundOffsetFor(shape, dimensions, selectedLidAngle);
  useCanvasRenderer(canvasRef, hitRegionsRef, faceRegionsRef, drawSceneRef, shape, dimensions, rotation, zoom, gridVisible, groundEnabled, focalLength, lidAngles, crownRoundness, hookEnabled, hookSizes, positions, colors, selectedIndex, selectedSurfaceIds, faceMaterials, decals, materialPickerEnabled);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateLimit = () => {
      const nextLimit = calculateZoomLimit(shape, dimensions, rotation, focalLength, lidAngles, crownRoundness, hookEnabled, hookSizes, positions, canvas.clientWidth, canvas.clientHeight);
      setZoomLimit(nextLimit);
      setZoom((current) => Math.min(current, nextLimit));
    };
    updateLimit();
    const observer = new ResizeObserver(updateLimit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [shape, dimensions, rotation, focalLength, lidAngles, crownRoundness, hookEnabled, hookSizes, positions]);
  const updateWorkspace = useCallback((targetShape: ShapeType, updater: (workspace: ShapeWorkspace) => ShapeWorkspace) => {
    setWorkspaces((current) => ({ ...current, [targetShape]: updater(current[targetShape]) }));
  }, []);
  const changeDimension = useCallback((key: keyof Dimensions, value: number) => updateWorkspace(shape, (workspace) => {
    const nextDimensions = { ...workspace.dimensions, [key]: value };
    const resized = { ...workspace, dimensions: nextDimensions, positions: workspace.positions.map(([x,y,z], index) => {
      if (!groundEnabled) return [x,y,z] as Vec3;
      const oldGroundY = groundOffsetFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0);
      const nextGroundY = groundOffsetFor(shape, nextDimensions, workspace.lidAngles[index] ?? 0);
      return [x, Math.abs(y-oldGroundY)<.02 ? nextGroundY : Math.max(y,nextGroundY), z] as Vec3;
    }) };
    return separateOverlappingInstances(shape, resized, groundEnabled);
  }), [shape, groundEnabled, updateWorkspace]);
  const selectInstance = (index: number) => updateWorkspace(shape, (workspace) => ({ ...workspace, selectedIndex: index, selectedSurfaceIds: [] }));
  const toggleGround = () => {
    if (groundEnabled) { setGroundEnabled(false); return; }
    setWorkspaces((current) => {
      const garment = { ...current.garment, positions: current.garment.positions.map(([x,,z]) => [x, groundOffsetFor("garment", current.garment.dimensions, 0), z] as Vec3) };
      const box = { ...current.box, positions: current.box.positions.map(([x,,z], index) => [x, groundOffsetFor("box", current.box.dimensions, current.box.lidAngles[index] ?? 0), z] as Vec3) };
      const cylinder = { ...current.cylinder, positions: current.cylinder.positions.map(([x,,z], index) => [x, groundOffsetFor("cylinder", current.cylinder.dimensions, current.cylinder.lidAngles[index] ?? 0), z] as Vec3) };
      return {
        garment: separateOverlappingInstances("garment", garment, true),
        box: separateOverlappingInstances("box", box, true),
        cylinder: separateOverlappingInstances("cylinder", cylinder, true),
      };
    });
    setGroundEnabled(true);
  };
  const changeQuantity = (nextQuantity: number) => {
    const next = Math.max(1, Math.min(12, Math.round(nextQuantity)));
    updateWorkspace(shape, (workspace) => {
      if (next <= workspace.positions.length) return {
        ...workspace,
        positions: workspace.positions.slice(0, next),
        lidAngles: workspace.lidAngles.slice(0, next),
        crownRoundness: workspace.crownRoundness.slice(0, next),
        hookEnabled: workspace.hookEnabled.slice(0, next),
        hookSizes: workspace.hookSizes.slice(0, next),
        colors: workspace.colors.slice(0, next),
        faceMaterials: Object.fromEntries(Object.entries(workspace.faceMaterials).filter(([key]) => Number(key.split(':')[0]) < next)),
        decals: Object.fromEntries(Object.entries(workspace.decals).filter(([key]) => Number(key.split(':')[0]) < next)),
        selectedIndex: Math.min(next - 1, workspace.selectedIndex),
        selectedSurfaceIds: [],
      };
      const nextPositions = [...workspace.positions];
      const nextLidAngles = [...workspace.lidAngles];
      const nextRoundness = [...workspace.crownRoundness];
      const nextHookEnabled = [...workspace.hookEnabled];
      const nextHookSizes = [...workspace.hookSizes];
      const nextColors = [...workspace.colors];
      const templateIndex = workspace.selectedIndex;
      let nextFaceMaterials = { ...workspace.faceMaterials };
      let nextDecals = { ...workspace.decals };
      while (nextPositions.length < next) {
        const index = nextPositions.length;
        const lidAngle = workspace.lidAngles[templateIndex] ?? 0;
        const roundness = workspace.crownRoundness[templateIndex] ?? 72;
        const hasHook = workspace.hookEnabled[templateIndex] ?? false;
        const hookSize = workspace.hookSizes[templateIndex] ?? 1;
        const localBounds = localBoundsFor(shape, workspace.dimensions, lidAngle, roundness, hasHook, hookSize);
        const obstacles = nextPositions.map((position, obstacleIndex) => worldBounds(
          localBoundsFor(shape, workspace.dimensions, nextLidAngles[obstacleIndex] ?? 0, nextRoundness[obstacleIndex] ?? 72, nextHookEnabled[obstacleIndex] ?? false, nextHookSizes[obstacleIndex] ?? 1),
          position,
        ));
        const baseY = groundEnabled ? groundOffsetFor(shape, workspace.dimensions, lidAngle) : 0;
        nextPositions.push(spawnBeside(localBounds, obstacles, baseY, 0) as Vec3);
        nextLidAngles.push(lidAngle);
        nextRoundness.push(roundness);
        nextHookEnabled.push(hasHook);
        nextHookSizes.push(hookSize);
        nextColors.push(workspace.colors[templateIndex] ?? '#ee6a35');
        nextFaceMaterials = cloneInstanceMaterials(nextFaceMaterials, templateIndex, index);
        nextDecals = cloneInstanceMaterials(nextDecals, templateIndex, index);
        if (index >= 11) break;
      }
      return { ...workspace, positions: nextPositions, lidAngles: nextLidAngles, crownRoundness: nextRoundness, hookEnabled: nextHookEnabled, hookSizes: nextHookSizes, colors: nextColors, faceMaterials: nextFaceMaterials, decals: nextDecals, selectedIndex: workspace.selectedIndex };
    });
  };
  const changePosition = (axis: 0 | 1 | 2, value: number) => {
    updateWorkspace(shape, (workspace) => {
      const current = workspace.positions[workspace.selectedIndex];
      const desired = current.map((item, itemIndex) => itemIndex === axis ? value : item) as Vec3;
      const resolved = collisionSafePosition(shape, workspace, workspace.selectedIndex, desired, groundEnabled);
      return { ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? resolved : position) };
    });
  };
  const resetSelectedPosition = () => updateWorkspace(shape, (workspace) => {
    const desired = [0, groundEnabled ? groundOffsetFor(shape,workspace.dimensions,workspace.lidAngles[workspace.selectedIndex] ?? 0) : 0, 0] as Vec3;
    const resolved = collisionSafePosition(shape, workspace, workspace.selectedIndex, desired, groundEnabled);
    return { ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? resolved : position) };
  });
  const changeSelectedLid = (angle: number) => updateWorkspace(shape, (workspace) => ({
    ...workspace,
    lidAngles: workspace.lidAngles.map((value, index) => index === workspace.selectedIndex ? angle : value),
    positions: workspace.positions.map(([x,y,z], index) => index === workspace.selectedIndex && groundEnabled ? [x, Math.max(y,groundOffsetFor(shape,workspace.dimensions,angle)), z] as Vec3 : [x,y,z] as Vec3),
  }));
  const changeSelectedRoundness = (roundness: number) => updateWorkspace("garment", (workspace) => separateOverlappingInstances("garment", {
    ...workspace,
    crownRoundness: workspace.crownRoundness.map((value, index) => index === workspace.selectedIndex ? roundness : value),
  }, groundEnabled));
  const toggleSelectedHook = () => updateWorkspace("garment", (workspace) => separateOverlappingInstances("garment", {
    ...workspace,
    hookEnabled: workspace.hookEnabled.map((value, index) => index === workspace.selectedIndex ? !value : value),
  }, groundEnabled));
  const changeSelectedHookSize = (size: number) => updateWorkspace("garment", (workspace) => separateOverlappingInstances("garment", {
    ...workspace,
    hookSizes: workspace.hookSizes.map((value, index) => index === workspace.selectedIndex ? size : value),
  }, groundEnabled));
  const changeSelectedColor = (color: string) => updateWorkspace(shape, (workspace) => ({
    ...workspace,
    colors: workspace.colors.map((value, index) => index === workspace.selectedIndex ? normalizedModelColor(color, value) : value),
  }));
  const uploadSelectedFaceTexture = (file: File | undefined) => {
    if (!file || !selectedSurfaceIds.length) return;
    const targetShape = shape, targetInstance = selectedIndex, targetSurfaces = [...selectedSurfaceIds], targetProjection = selectedProjection;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      updateWorkspace(targetShape, (workspace) => {
        const faceMaterials = { ...workspace.faceMaterials };
        targetSurfaces.forEach((surfaceId) => { faceMaterials[faceMaterialKey(targetInstance, surfaceId)] = { src: reader.result as string, name: file.name, size: 1, projection: targetProjection }; });
        return { ...workspace, faceMaterials };
      });
    };
    reader.readAsDataURL(file);
  };
  const changeSelectedTextureSize = (size: number) => {
    if (!selectedSurfaceIds.length) return;
    updateWorkspace(shape, (workspace) => {
      const faceMaterials = { ...workspace.faceMaterials };
      selectedSurfaceIds.forEach((surfaceId) => {
        const key = faceMaterialKey(selectedIndex, surfaceId);
        if (faceMaterials[key]) faceMaterials[key] = { ...faceMaterials[key], size };
      });
      return { ...workspace, faceMaterials };
    });
  };
  const changeSelectedProjection = (projection: ProjectionMode) => {
    setNewMaterialProjection(projection);
    if (!selectedSurfaceIds.length) return;
    updateWorkspace(shape, (workspace) => {
      const faceMaterials = { ...workspace.faceMaterials };
      selectedSurfaceIds.forEach((surfaceId) => {
        const key = faceMaterialKey(selectedIndex, surfaceId);
        if (faceMaterials[key]) faceMaterials[key] = { ...faceMaterials[key], projection };
      });
      return { ...workspace, faceMaterials };
    });
  };
  const removeSelectedFaceTexture = () => {
    if (!selectedSurfaceIds.length) return;
    updateWorkspace(shape, (workspace) => {
      const faceMaterials = { ...workspace.faceMaterials };
      selectedSurfaceIds.forEach((surfaceId) => delete faceMaterials[faceMaterialKey(selectedIndex, surfaceId)]);
      return { ...workspace, faceMaterials };
    });
  };
  const uploadSelectedDecal = (file: File | undefined) => {
    if (!file || !selectedSurfaceIds.length || (file.type && file.type !== 'image/png')) return;
    const targetShape = shape, targetInstance = selectedIndex, targetSurfaces = [...selectedSurfaceIds];
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      updateWorkspace(targetShape, (workspace) => {
        const nextDecals = { ...workspace.decals };
        targetSurfaces.forEach((surfaceId) => { nextDecals[faceMaterialKey(targetInstance, surfaceId)] = { src: reader.result as string, name: file.name, u: .5, v: .5, size: .34 }; });
        return { ...workspace, decals: nextDecals };
      });
    };
    reader.readAsDataURL(file);
  };
  const changeSelectedDecal = (field: 'u' | 'v' | 'size', value: number) => {
    if (!selectedSurfaceIds.length) return;
    updateWorkspace(shape, (workspace) => {
      const nextDecals = { ...workspace.decals };
      selectedSurfaceIds.forEach((surfaceId) => {
        const key = faceMaterialKey(selectedIndex, surfaceId);
        if (nextDecals[key]) nextDecals[key] = { ...nextDecals[key], [field]: value };
      });
      return { ...workspace, decals: nextDecals };
    });
  };
  const removeSelectedDecal = () => {
    if (!selectedSurfaceIds.length) return;
    updateWorkspace(shape, (workspace) => {
      const nextDecals = { ...workspace.decals };
      selectedSurfaceIds.forEach((surfaceId) => delete nextDecals[faceMaterialKey(selectedIndex, surfaceId)]);
      return { ...workspace, decals: nextDecals };
    });
  };
  const resetView = () => { setRotation({ yaw: -.62, pitch: -.38 }); setZoom(1); };
  const setView = (view: "front" | "top" | "iso") => {
    if (view === "front") setRotation({ yaw: 0, pitch: 0 });
    if (view === "top") setRotation({ yaw: 0, pitch: -Math.PI / 2 + .02 });
    if (view === "iso") setRotation({ yaw: -.62, pitch: -.38 });
  };
  const animateLid = (target: number) => {
    if (lidAnimationRef.current) cancelAnimationFrame(lidAnimationRef.current);
    const animatedShape = shape;
    const animatedIndex = selectedIndex;
    const start = lidAngles[animatedIndex] ?? 0;
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / 360);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextAngle = start + (target - start) * eased;
      updateWorkspace(animatedShape, (workspace) => ({
        ...workspace,
        lidAngles: workspace.lidAngles.map((value, index) => index === animatedIndex ? nextAngle : value),
        positions: workspace.positions.map(([x,y,z], index) => index === animatedIndex && groundEnabled
          ? [x, Math.max(y, groundOffsetFor(animatedShape, workspace.dimensions, nextAngle)), z] as Vec3
          : [x,y,z] as Vec3),
      }));
      if (progress < 1) lidAnimationRef.current = requestAnimationFrame(tick);
    };
    lidAnimationRef.current = requestAnimationFrame(tick);
  };
  const saveJpg = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawSceneRef.current?.(true);
    canvas.toBlob((blob) => {
      drawSceneRef.current?.(false);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `form3d-free-layout-${shape}-${quantity}x-${focalLength}mm-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setCaptureStatus(true);
      window.setTimeout(() => setCaptureStatus(false), 1500);
    }, "image/jpeg", .94);
  };
  const fieldOfView = Math.round((2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI);
  return <main className="studio-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Box size={19} strokeWidth={2.2} /></span><div><strong>FORM<span>3D</span></strong><small>形体工作台</small></div></div><div className="topbar-status"><span className="status-dot" />实时预览</div></header>
    <div className="workspace">
      <aside className="shape-panel" aria-label="图形选择"><div className="panel-title"><span>01</span><div><strong>选择图形</strong><small>各模型独立工作区</small></div></div><div className="shape-list">
        {SHAPES.map((item) => { const Icon = item.icon; return <Button key={item.id} variant="ghost" className={`shape-button ${shape === item.id ? "is-active" : ""}`} onClick={() => setShape(item.id)} aria-pressed={shape === item.id}><span className="shape-icon"><Icon size={25} strokeWidth={1.55} /></span><span>{item.label}</span><i /></Button>; })}
      </div><div className="interaction-tip"><MousePointer2 size={18} /><p><strong>点中图形后拖动摆放</strong><span>拖动空白旋转 · 滚轮缩放</span></p></div></aside>
      <section className="viewport-panel" aria-label="3D 预览区">
        <div className="viewport-meta"><div><span className="eyebrow">PERSPECTIVE / {focalLength}mm</span><strong>{SHAPES.find((item) => item.id === shape)?.label} × {quantity}</strong></div><div className="view-actions"><Button className="capture-button" size="sm" onClick={saveJpg}><Download size={15}/>{captureStatus ? "已保存" : "拍照 JPG"}</Button><Button variant="ghost" size="sm" onClick={toggleGround} aria-pressed={groundEnabled}>{groundEnabled ? <Minus size={15}/> : <Plus size={15}/>} {groundEnabled ? "移除地面" : "添加地面"}</Button><Button variant="ghost" size="sm" onClick={() => setGridVisible((v) => !v)} aria-pressed={gridVisible}><Grid3X3 size={16} />网格</Button><Button variant="ghost" size="sm" onClick={resetView}><Redo2 size={15} />复位</Button></div></div>
        <div className={`canvas-stage ${captureStatus ? "is-captured" : ""}`}><canvas ref={canvasRef} tabIndex={0} aria-label="1比1画布，点中图形可自由拖动位置，拖动空白旋转视角"
          onPointerDown={(e) => { const rect=e.currentTarget.getBoundingClientRect(); const x=e.clientX-rect.left,y=e.clientY-rect.top; const faceHit=materialPickerEnabled?[...faceRegionsRef.current].reverse().find((region)=>pointInPolygon(x,y,region.polygon)):undefined; if(faceHit){ const append=e.shiftKey; updateWorkspace(shape,(workspace)=>({...workspace,selectedIndex:faceHit.instanceIndex,selectedSurfaceIds:updateSurfaceSelection(workspace.selectedIndex===faceHit.instanceIndex?workspace.selectedSurfaceIds:[],faceHit.surfaceId,append)})); return; } const hit=[...hitRegionsRef.current].sort((a,b)=>a.radius-b.radius).find((region)=>Math.hypot(x-region.x,y-region.y)<=region.radius+10); e.currentTarget.setPointerCapture(e.pointerId); if(hit)selectInstance(hit.index); pointerRef.current = { id:e.pointerId, x:e.clientX, y:e.clientY, action:hit?"object":"camera", objectIndex:hit?.index ?? -1 }; e.currentTarget.classList.add(hit?"is-moving-object":"is-dragging"); }}
          onPointerMove={(e) => { const p=pointerRef.current; if(!p||p.id!==e.pointerId)return; const dx=e.clientX-p.x,dy=e.clientY-p.y; if(p.action==="camera")setRotation((r)=>({yaw:r.yaw+dx*.009,pitch:Math.max(-1.48,Math.min(1.48,r.pitch+dy*.009))})); else { const canvas=e.currentTarget; const factor=2.45/(Math.max(220,Math.min(canvas.clientWidth,canvas.clientHeight))*zoom); const [wx,wy,wz]=inverseRotate([dx*factor,-dy*factor,0],rotation.yaw,rotation.pitch); updateWorkspace(shape,(workspace)=>{ const current=workspace.positions[p.objectIndex]; const desired=[current[0]+wx,current[1]+wy,current[2]+wz] as Vec3; const resolved=collisionSafePosition(shape,workspace,p.objectIndex,desired,groundEnabled); return { ...workspace, positions:workspace.positions.map((position,index)=>index===p.objectIndex?resolved:position) }; }); } pointerRef.current={...p,x:e.clientX,y:e.clientY}; }}
          onPointerUp={(e) => { pointerRef.current=null; e.currentTarget.classList.remove("is-dragging","is-moving-object"); }} onPointerCancel={(e) => { pointerRef.current=null; e.currentTarget.classList.remove("is-dragging","is-moving-object"); }} onDoubleClick={resetView}
          onWheel={(e) => { e.preventDefault(); setZoom((z)=>Math.max(Math.min(MIN_ZOOM,zoomLimit * .5),Math.min(zoomLimit,z-e.deltaY*.0015))); }}
          onKeyDown={(e) => { if(e.key==="ArrowLeft")setRotation((r)=>({...r,yaw:r.yaw-.08})); if(e.key==="ArrowRight")setRotation((r)=>({...r,yaw:r.yaw+.08})); if(e.key==="ArrowUp")setRotation((r)=>({...r,pitch:Math.max(-1.48,r.pitch-.08)})); if(e.key==="ArrowDown")setRotation((r)=>({...r,pitch:Math.min(1.48,r.pitch+.08)})); if(e.key==="0")resetView(); }} />
          <div className="canvas-ratio-label">1:1 极限画布</div><div className="dimension-badge badge-width"><span>W</span>{dimensionLabel(dimensions.width)}</div><div className="dimension-badge badge-height"><span>H</span>{dimensionLabel(dimensions.height)}</div><div className="dimension-badge badge-depth"><span>D</span>{dimensionLabel(dimensions.depth)}</div><div className="camera-readout"><Camera size={14}/><span>{focalLength}mm · {fieldOfView}°</span></div><div className="zoom-readout"><Rotate3D size={15} /><span>{Math.round(zoom*100)}% / 极限 {Math.round(zoomLimit*100)}%</span></div><div className="capture-confirmation"><Camera size={16}/>JPG 已保存</div>
          {groundEnabled && <div className="ground-status"><span className="status-dot"/>固定地面 · 防穿透</div>}
        </div>
        <div className="view-presets" aria-label="视角预设"><span>快速视角</span><Button variant="outline" size="sm" onClick={()=>setView("front")}>正面</Button><Button variant="outline" size="sm" onClick={()=>setView("top")}>顶面</Button><Button variant="outline" size="sm" onClick={()=>setView("iso")}>等轴</Button></div>
      </section>
      <aside className="control-panel" aria-label="模型与摄像机控制"><div className="panel-title"><span>02</span><div><strong>调整尺寸</strong><small>实时改变比例</small></div></div><div className="controls">
        {isGarment ? <><DimensionControl label="宽度" axis="W" value={Math.round(dimensions.width * 100)} unit="%" onChange={(v)=>changeDimension("width",v / 100)} /><DimensionControl label="底部高度" axis="H" value={Math.round(dimensions.height * 100)} unit="%" minValue={50} onChange={(v)=>changeDimension("height",v / 100)} /><DimensionControl label="厚度" axis="D" value={Math.round(dimensions.depth * 100)} unit="%" onChange={(v)=>changeDimension("depth",v / 100)} /></> : <><DimensionControl label="长度" axis="W" value={dimensions.width} unit="cm" onChange={(v)=>changeDimension("width",v)} /><DimensionControl label="高度" axis="H" value={dimensions.height} unit="cm" onChange={(v)=>changeDimension("height",v)} /><DimensionControl label="深度" axis="D" value={dimensions.depth} unit="cm" onChange={(v)=>changeDimension("depth",v)} /></>}
        <div className="scale-control"><div className="control-heading"><span><Maximize2 size={16}/>整体大小</span><output>{dimensions.scale.toFixed(1)}×</output></div><Slider aria-label="整体大小" min={.5} max={2} step={.1} value={[dimensions.scale]} onValueChange={([next])=>changeDimension("scale",next)} /><div className="slider-ends"><span>0.5×</span><span>2.0×</span></div></div>
      </div><div className="size-summary"><span>{isGarment ? "宽 × 底部高度 × 厚 · 相对比例" : "当前尺寸"}</span><strong>{dimensionLabel(dimensions.width)} × {dimensionLabel(dimensions.height)} × {dimensionLabel(dimensions.depth)}</strong><small>{isGarment ? "高度只改变底边 · 弧顶与可选挂钩保持原形" : `单位：厘米 · 比例 ${dimensions.scale.toFixed(1)}×`}</small>{isGarment && <Button variant="secondary" size="sm" onClick={()=>updateWorkspace("garment", (workspace)=>({...workspace, dimensions:{width:1,height:1,depth:1,scale:1}, positions:workspace.positions.map(([x,y,z])=>[x, groundEnabled ? Math.max(y, -.04) : y,z] as Vec3)}))}>恢复初始比例</Button>}</div>
        <section className="editor-section instance-section" aria-label="数量与自由摆放">
          <div className="section-heading"><span><Copy size={16}/>数量与自由摆放</span><output>{quantity} 个</output></div>
          <div className="quantity-stepper"><Button variant="outline" size="icon" aria-label="减少数量" disabled={quantity<=1} onClick={()=>changeQuantity(quantity-1)}><Minus size={14}/></Button><strong>{quantity}</strong><Button variant="outline" size="icon" aria-label="增加数量" disabled={quantity>=12} onClick={()=>changeQuantity(quantity+1)}><Plus size={14}/></Button></div>
          <Slider aria-label="几何图形数量" min={1} max={12} step={1} value={[quantity]} onValueChange={([next])=>changeQuantity(next)} />
          <p className="free-layout-tip"><Move3D size={14}/>新增时复制当前形体的材质、投射和组件状态，并自动接触摆放。</p>
          <div className="instance-picker" aria-label="选择要编辑的形体">{positions.map((_,index)=><Button key={index} size="sm" variant={selectedIndex===index?"default":"outline"} onClick={()=>selectInstance(index)} aria-pressed={selectedIndex===index}>{index+1}</Button>)}</div>
          <div className="position-editor">
            <div className="section-heading"><span><LocateFixed size={15}/>形体 {selectedIndex+1} 坐标</span><Button variant="ghost" size="sm" onClick={resetSelectedPosition}>归零</Button></div>
            {([0,1,2] as const).map((axis)=>{ const labels=["X 左右","Y 上下","Z 前后"]; const axisNames=["X","Y","Z"]; const minimum=axis===1&&groundEnabled?groundMinY:-2.5; const maximum=Math.max(2.5, minimum+2.5); return <div className="position-row" key={axis}><label><b>{axisNames[axis]}</b>{labels[axis]}</label><Slider aria-label={`${labels[axis]}位置`} min={minimum} max={maximum} step={.01} value={[positions[selectedIndex]?.[axis] ?? 0]} onValueChange={([next])=>changePosition(axis,next)} /><input aria-label={`${labels[axis]}坐标值`} type="number" min={minimum} max={maximum} step="0.01" value={(positions[selectedIndex]?.[axis] ?? 0).toFixed(2)} onChange={(e)=>changePosition(axis,Math.max(minimum,Math.min(maximum,Number(e.target.value)||0)))} /></div>; })}
          </div>
        </section>
        <section className="editor-section material-section" aria-label="模型表面材质">
          <div className="section-heading"><span><Palette size={16}/>表面材质</span><output>{selectedSurfaceIds.length > 1 ? `${selectedSurfaceIds.length} 个面` : surfaceLabel(shape, primarySurfaceId)}</output></div>
          <div className="model-color-control">
            <div><span className="color-preview" style={{ backgroundColor: selectedColor }}/><p><strong>形体 {selectedIndex + 1} 基础颜色</strong><small>仅修改当前编号模型；贴图表面保持原材质。</small></p></div>
            <label className="color-picker" title="选择模型颜色"><input aria-label={`形体 ${selectedIndex + 1} 基础颜色`} type="color" value={selectedColor} onChange={(event)=>changeSelectedColor(event.target.value)} /><span>{selectedColor.toUpperCase()}</span></label>
          </div>
          <p>点击选择单个表面；按住 Shift 再点击可追加或取消多个面，并统一添加同一种贴图。</p>
          <Button className="material-mode-button" variant={materialPickerEnabled?"default":"outline"} aria-pressed={materialPickerEnabled} onClick={()=>setMaterialPickerEnabled((enabled)=>!enabled)}><MousePointer2 size={15}/>{materialPickerEnabled?"正在选面 · 点击表面":"启用选面"}</Button>
          {!selectedSurfaceIds.length ? <div className="material-empty">请先启用选面，并点击需要添加材质的表面</div> : <>
            <div className="selected-surface-list">{selectedSurfaceIds.map((surfaceId)=><span key={surfaceId}>{surfaceLabel(shape,surfaceId)}</span>)}</div>
            <div className="projection-switch" aria-label="材质投射方式"><span>投射方式</span><div><Button size="sm" variant={selectedProjection==='cube'?"default":"outline"} aria-pressed={selectedProjection==='cube'} onClick={()=>changeSelectedProjection('cube')}>立方体</Button><Button size="sm" variant={selectedProjection==='uvw'?"default":"outline"} aria-pressed={selectedProjection==='uvw'} onClick={()=>changeSelectedProjection('uvw')}>UVW</Button></div></div>
            <label className="texture-upload"><Upload size={15}/><span>{selectedSurfaceIds.length > 1 ? `应用贴图到 ${selectedSurfaceIds.length} 个面` : selectedFaceMaterial?"更换无缝贴图":"上传无缝贴图"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event)=>{ uploadSelectedFaceTexture(event.currentTarget.files?.[0]); event.currentTarget.value=''; }} /></label>
            {selectedFaceMaterial && <>
              <div className="texture-status"><span className="status-dot"/><div><strong>{selectedProjection==='cube'?"立方体投射":"UVW 贴图投射"}已启用</strong><small title={selectedFaceMaterial.name}>{selectedFaceMaterial.name}</small></div><Button variant="ghost" size="icon" aria-label="移除所选面的材质" onClick={removeSelectedFaceTexture}><Trash2 size={14}/></Button></div>
              <div className="texture-size-control"><div className="control-heading"><span><Maximize2 size={15}/>贴图大小</span><label className="value-field texture-value-field"><input aria-label="输入贴图大小百分比" type="number" min={25} max={400} step={1} value={Math.round(selectedFaceMaterial.size * 100)} onChange={(event)=>changeSelectedTextureSize(textureSizeFromPercent(Number(event.target.value)))} /><span>%</span></label></div><Slider aria-label={`形体 ${selectedIndex+1} 所选表面贴图大小`} min={25} max={400} step={1} value={[Math.round(selectedFaceMaterial.size * 100)]} onValueChange={([next])=>changeSelectedTextureSize(next / 100)} /><div className="slider-ends"><span>25% · 更多重复</span><span>400% · 更大纹理</span></div></div>
            </>}
            <div className="component-divider material-divider" />
            <div className="decal-heading"><span><ImageIcon size={15}/>透明 PNG 贴花</span><small>Logo / 印花</small></div>
            <label className="texture-upload decal-upload"><Upload size={15}/><span>{selectedDecal ? "更换透明 PNG" : selectedSurfaceIds.length > 1 ? `应用贴花到 ${selectedSurfaceIds.length} 个面` : "上传透明 PNG"}</span><input type="file" accept="image/png" onChange={(event)=>{ uploadSelectedDecal(event.currentTarget.files?.[0]); event.currentTarget.value=''; }} /></label>
            {selectedDecal && <>
              <div className="texture-status decal-status"><span className="status-dot"/><div><strong>贴花已吸附到所选表面</strong><small title={selectedDecal.name}>{selectedDecal.name}</small></div><Button variant="ghost" size="icon" aria-label="移除所选面的透明 PNG 贴花" onClick={removeSelectedDecal}><Trash2 size={14}/></Button></div>
              <div className="decal-controls">
                {([['u','水平位置',0,100],['v','垂直位置',0,100],['size','贴花大小',5,200]] as const).map(([field,label,min,max])=>{ const current=Math.round(selectedDecal[field]*100); return <div className="decal-control-row" key={field}><div className="control-heading"><span>{label}</span><label className="value-field texture-value-field"><input aria-label={`${label}百分比`} type="number" min={min} max={max} step={1} value={current} onChange={(event)=>changeSelectedDecal(field,decalPercent(Number(event.target.value),min,max))}/><span>%</span></label></div><Slider aria-label={`${label}`} min={min} max={max} step={1} value={[current]} onValueChange={([next])=>changeSelectedDecal(field,next/100)}/></div>; })}
              </div>
            </>}
          </>}
          <div className="projection-note"><Grid3X3 size={14}/><span>{selectedProjection==='cube'?"立方体投射依据 X / Y / Z 方向保持纹理尺寸。":"UVW 按模型坐标展开，圆柱侧面会连续环绕。"} PNG 贴花独立叠加并保留透明区域。</span></div>
        </section>
        {isGarment && <section className="editor-section garment-section" aria-label="西服套弧顶与挂钩">
          <div className="section-heading"><span><Circle size={16}/>形体 {selectedIndex+1} 顶部弧度</span><output>{Math.round(selectedRoundness)}%</output></div>
          <p>连续调整弧顶圆度；宽度与高度变化后仍保持平顺轮廓。</p>
          <Slider aria-label={`形体 ${selectedIndex+1} 顶部弧顶圆度`} min={0} max={100} step={1} value={[selectedRoundness]} onValueChange={([next])=>changeSelectedRoundness(next)} />
          <div className="lid-angle-range"><span>0% 平顶</span><span>100% 圆弧</span></div>
          <div className="crown-presets"><Button variant="outline" size="sm" onClick={()=>changeSelectedRoundness(0)}>平顶</Button><Button variant="outline" size="sm" onClick={()=>changeSelectedRoundness(50)}>柔弧</Button><Button size="sm" onClick={()=>changeSelectedRoundness(100)}>圆弧</Button></div>
          <div className="component-divider" />
          <div className="hook-toggle"><div><span><Link2 size={15}/>挂钩</span><small>启用后自动吸附于当前形体的弧顶正中。</small></div><Button size="sm" variant={selectedHookEnabled?"default":"outline"} aria-pressed={selectedHookEnabled} onClick={toggleSelectedHook}>{selectedHookEnabled?"已启用":"启用挂钩"}</Button></div>
          <div className="hook-size-control">
            <div className="control-heading"><span><Maximize2 size={15}/>挂钩大小</span><output>{Math.round(selectedHookSize * 100)}%</output></div>
            <Slider aria-label={`形体 ${selectedIndex+1} 挂钩大小`} min={50} max={200} step={1} value={[Math.round(selectedHookSize * 100)]} onValueChange={([next])=>changeSelectedHookSize(next / 100)} />
            <div className="slider-ends"><span>50%</span><span>200%</span></div>
          </div>
        </section>}
        <section className="editor-section camera-section" aria-label="透视摄像机">
          <div className="section-heading"><span><Camera size={16}/>透视摄像机</span><output>{focalLength} mm</output></div>
          <div className="lens-presets">{[24,35,50,85,135].map((lens)=><Button key={lens} size="sm" variant={focalLength===lens?"default":"outline"} onClick={()=>setFocalLength(lens)}>{lens}</Button>)}</div>
          <Slider aria-label="摄像机焦距" min={18} max={135} step={1} value={[focalLength]} onValueChange={([next])=>setFocalLength(next)} />
          <div className="camera-meta"><span>18mm 广角</span><b>视场角 {fieldOfView}°</b><span>135mm 长焦</span></div>
        </section>
        {!isGarment && <section className="editor-section lid-section" aria-label="顶部盖面编辑">
          <div className="section-heading"><span><DoorOpen size={17}/>形体 {selectedIndex+1} 顶部盖面</span><output>{Math.round(selectedLidAngle)}°</output></div>
          <p>只控制当前选中的形体；{shape === "box" ? "沿长方体后边缘铰链翻动" : "沿圆柱体后侧铰链翻动"}。</p>
          <Slider aria-label={`形体 ${selectedIndex+1} 盖面开启角度`} min={0} max={200} step={1} value={[selectedLidAngle]} onValueChange={([next])=>changeSelectedLid(next)} />
          <div className="lid-angle-range"><span>0° 关闭</span><span>200° 翻至背后</span></div>
          <div className="lid-presets"><Button variant="outline" size="sm" onClick={()=>animateLid(0)}>关闭</Button><Button variant="outline" size="sm" onClick={()=>animateLid(60)}>半开</Button><Button variant="outline" size="sm" onClick={()=>animateLid(110)}>打开</Button><Button size="sm" onClick={()=>animateLid(180)}>翻至背面</Button></div>
        </section>}
      </aside>
    </div>
  </main>;
}
