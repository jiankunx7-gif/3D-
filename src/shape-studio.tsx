"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Camera, Circle, Copy, Cylinder, DoorOpen, Download, Grid3X3, ImageIcon, Link2, LocateFixed, Maximize2, Minus, MousePointer2, Move3D, PackageOpen, Palette, Plus, Redo2, Rotate3D, Scissors, Shirt, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { garmentFaces } from './garment-model';
import { openingContourOnFace, openingContourOnSide, openingShapeLabel, openingsOverlap, openingSideWallQuads, openingWallQuads, type GarmentOpening, type OpeningShape } from './garment-openings';
import { boundsOverlap, resolveCollisionMove, spawnBeside, worldBounds, type CollisionBounds } from './collision';
import { affineTriangleMap, cubeProjectionUvs, textureWorldPeriod, uvwProjectionUvs, type ProjectionBounds } from './texture-projection';
import { cloneInstanceMaterials, decalPercent, normalizedModelColor, scaledDecalDimensions, shadedModelColor, textureSizeFromPercent, updateSurfaceSelection } from './surface-material';

type ShapeType = "box" | "cylinder" | "trapezoid" | "garment";
type Dimensions = { width: number; height: number; depth: number; scale: number };
type Vec3 = [number, number, number];
type ProjectionMode = 'cube' | 'uvw';
type CanvasProjection = 'perspective' | 'orthographic';
type OrthographicView = 'front' | 'top' | 'right';
type TextureMaterial = { src: string; name: string; size: number; projection: ProjectionMode };
type Decal = { src: string; name: string; u: number; v: number; width: number; height: number; scale: number };
type ShapeWorkspace = { dimensions: Dimensions; instanceDimensions: Dimensions[]; positions: Vec3[]; lidAngles: number[]; crownRoundness: number[]; hookEnabled: boolean[]; hookSizes: number[]; colors: string[]; selectedIndex: number; selectedSurfaceIds: string[]; faceMaterials: Record<string, TextureMaterial>; decals: Record<string, Decal>; openings: GarmentOpening[][]; selectedOpeningId: string | null; openingSurfaceId: 'front' | 'back' | 'side' };
type SceneFace = { points: Vec3[]; material: "body" | "lid" | "inside" | "trim" | "hook"; surfaceId: string };
type InstanceFace = SceneFace & { shape: ShapeType; instanceIndex: number; localPoints: Vec3[] };
type HitRegion = { shape: ShapeType; index: number; x: number; y: number; radius: number };
type FaceHitRegion = { shape: ShapeType; instanceIndex: number; surfaceId: string; polygon: { x: number; y: number }[]; holes?: { x: number; y: number }[][] };
type OpeningHitRegion = { shape: ShapeType; instanceIndex: number; openingId: string; surfaceId: 'front' | 'back' | 'side'; polygon: { x: number; y: number }[] };
type GizmoAxis = 'x' | 'y' | 'z';
type GizmoHitRegion = { shape:ShapeType; index:number; axis:GizmoAxis; start:{x:number;y:number}; end:{x:number;y:number}; direction:{x:number;y:number} };
type CanvasPointerState = { id:number; x:number; y:number; action:'object'|'camera'|'pan'|'gizmo'; objectShape:ShapeType; objectIndex:number; axis?:GizmoAxis; axisScreen?:{x:number;y:number} };
const GROUND_Y = -0.64;
const MIN_ZOOM = .28;
const MAX_ZOOM_SEARCH = 8;
const CANVAS_EDGE_PADDING = 16;
const SHAPE_NORMALIZATION: Record<ShapeType,number> = { box:4, cylinder:4, trapezoid:4, garment:1 };

const SHAPES = [
  { id: "box" as const, label: "长方体", icon: Box },
  { id: "cylinder" as const, label: "圆柱体", icon: Cylinder },
  { id: "trapezoid" as const, label: "梯形盒", icon: PackageOpen },
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
  } else if (shape === "trapezoid") {
    const x0=-width/2, x1=width/2, z0=-depth/2, z1=depth/2;
    const frontTopY=bottomY+height*.34;
    const backTopY=hingeY;
    const shoulderZ=z0+depth*.44;
    const ix0=x0+thickness, ix1=x1-thickness, iz0=z0+thickness, iz1=z1-thickness;
    const innerShoulderZ=shoulderZ+thickness;
    const innerBottomY=bottomY+thickness;
    faces.push(
      { material:'body', surfaceId:'outer-back', points:[[x0,bottomY,z0],[x0,backTopY,z0],[x1,backTopY,z0],[x1,bottomY,z0]] },
      { material:'body', surfaceId:'outer-front', points:[[x0,bottomY,z1],[x1,bottomY,z1],[x1,frontTopY,z1],[x0,frontTopY,z1]] },
      { material:'body', surfaceId:'outer-left', points:[[x0,bottomY,z0],[x0,bottomY,z1],[x0,frontTopY,z1],[x0,backTopY,shoulderZ],[x0,backTopY,z0]] },
      { material:'body', surfaceId:'outer-right', points:[[x1,bottomY,z0],[x1,backTopY,z0],[x1,backTopY,shoulderZ],[x1,frontTopY,z1],[x1,bottomY,z1]] },
      { material:'body', surfaceId:'outer-bottom', points:[[x0,bottomY,z0],[x1,bottomY,z0],[x1,bottomY,z1],[x0,bottomY,z1]] },
      { material:lidAngle>2?'inside':'body', surfaceId:'fixed-slope', points:[[x0,frontTopY,z1],[x1,frontTopY,z1],[x1,backTopY,shoulderZ],[x0,backTopY,shoulderZ]] },
      { material:'trim', surfaceId:'rim', points:[[x0,backTopY,z0],[x1,backTopY,z0],[ix1,backTopY,iz0],[ix0,backTopY,iz0]] },
      { material:'trim', surfaceId:'rim', points:[[x0,backTopY,shoulderZ],[ix0,backTopY,innerShoulderZ],[ix1,backTopY,innerShoulderZ],[x1,backTopY,shoulderZ]] },
      { material:'trim', surfaceId:'rim', points:[[x0,backTopY,z0],[ix0,backTopY,iz0],[ix0,backTopY,innerShoulderZ],[x0,backTopY,shoulderZ]] },
      { material:'trim', surfaceId:'rim', points:[[x1,backTopY,z0],[x1,backTopY,shoulderZ],[ix1,backTopY,innerShoulderZ],[ix1,backTopY,iz0]] },
      { material:'inside', surfaceId:'inside-back', points:[[ix0,innerBottomY,iz0],[ix1,innerBottomY,iz0],[ix1,backTopY-thickness,iz0],[ix0,backTopY-thickness,iz0]] },
      { material:'inside', surfaceId:'inside-front', points:[[ix0,innerBottomY,iz1],[ix0,frontTopY-thickness,iz1],[ix1,frontTopY-thickness,iz1],[ix1,innerBottomY,iz1]] },
      { material:'inside', surfaceId:'inside-left', points:[[ix0,innerBottomY,iz0],[ix0,backTopY-thickness,iz0],[ix0,backTopY-thickness,innerShoulderZ],[ix0,frontTopY-thickness,iz1],[ix0,innerBottomY,iz1]] },
      { material:'inside', surfaceId:'inside-right', points:[[ix1,innerBottomY,iz0],[ix1,innerBottomY,iz1],[ix1,frontTopY-thickness,iz1],[ix1,backTopY-thickness,innerShoulderZ],[ix1,backTopY-thickness,iz0]] },
      { material:'inside', surfaceId:'inside-bottom', points:[[ix0,innerBottomY,iz0],[ix0,innerBottomY,iz1],[ix1,innerBottomY,iz1],[ix1,innerBottomY,iz0]] },
    );
    const lidVertices:Vec3[]=[
      [x0,backTopY,z0],[x1,backTopY,z0],[x1,backTopY,shoulderZ],[x0,backTopY,shoulderZ],
      [x0,backTopY+thickness,z0],[x1,backTopY+thickness,z0],[x1,backTopY+thickness,shoulderZ],[x0,backTopY+thickness,shoulderZ],
    ].map((point)=>hingeRotate(point,backTopY,z0,angle));
    [
      { indices:[0,3,2,1],surfaceId:'lid-inner' },{ indices:[4,5,6,7],surfaceId:'lid-outer' },
      { indices:[0,1,5,4],surfaceId:'lid-back-edge' },{ indices:[3,7,6,2],surfaceId:'lid-front-edge' },
      { indices:[0,4,7,3],surfaceId:'lid-left-edge' },{ indices:[1,2,6,5],surfaceId:'lid-right-edge' },
    ].forEach(({indices,surfaceId})=>faces.push({ material:'lid',surfaceId,points:indices.map((index)=>lidVertices[index]) }));
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

function garmentInteriorFaces(faces: InstanceFace[], openings: GarmentOpening[]): InstanceFace[] {
  if (!openings.length) return [];
  const result: InstanceFace[] = [];
  const bodyPoints = faces.filter((face) => face.material !== 'hook').flatMap((face) => face.localPoints);
  const depthRange = Math.max(...bodyPoints.map((point) => point[2])) - Math.min(...bodyPoints.map((point) => point[2]));
  const wallDepth = Math.max(.004, depthRange * .07);
  const instanceIndex = faces[0]?.instanceIndex ?? 0;
  const position = faces[0] ? faces[0].points[0].map((value,axis) => value - faces[0].localPoints[0][axis]) as Vec3 : [0,0,0];
  const surfacesWithOpenings = new Set(openings.map((opening) => opening.surfaceId));
  openings.forEach((opening) => {
    const sideFaces = faces.filter((face) => face.surfaceId === 'side');
    const panel = faces.find((face) => face.surfaceId === opening.surfaceId);
    if (!panel) return;
    const sideResult = opening.surfaceId === 'side' ? openingSideWallQuads(opening,sideFaces.map((face)=>face.localPoints),wallDepth) : null;
    const localWalls = (sideResult?.walls ?? openingWallQuads(opening,panel.localPoints,wallDepth)) as Vec3[][];
    localWalls.forEach((localPoints) => result.push({
      material:'inside', surfaceId:`opening-wall-${opening.id}`, shape:'garment', instanceIndex, localPoints,
      points:localPoints.map((point) => point.map((value,axis) => value + position[axis]) as Vec3),
    }));
    if (sideResult) {
      const localPoints = sideResult.inner.map(([x,y,z]) => {
        const centerX=bodyPoints.reduce((sum,point)=>sum+point[0],0)/bodyPoints.length;
        const centerY=bodyPoints.reduce((sum,point)=>sum+point[1],0)/bodyPoints.length;
        const distance=Math.hypot(centerX-x,centerY-y)||1;
        return [x+(centerX-x)/distance*wallDepth*2.5,y+(centerY-y)/distance*wallDepth*2.5,z] as Vec3;
      });
      result.push({ material:'inside', surfaceId:`opening-cavity-${opening.id}`, shape:'garment', instanceIndex, localPoints, points:localPoints.map((point)=>point.map((value,axis)=>value+position[axis]) as Vec3) });
    }
  });
  if (surfacesWithOpenings.has('front')) {
    const back = faces.find((face) => face.surfaceId === 'back');
    if (back) {
      const localPoints = back.localPoints.map(([x,y,z]) => [x,y,z + wallDepth] as Vec3);
      result.push({ material:'inside', surfaceId:'inside-back', shape:'garment', instanceIndex, localPoints, points:localPoints.map((point) => point.map((value,axis) => value + position[axis]) as Vec3) });
    }
  }
  if (surfacesWithOpenings.has('back')) {
    const front = faces.find((face) => face.surfaceId === 'front');
    if (front) {
      const localPoints = front.localPoints.map(([x,y,z]) => [x,y,z - wallDepth] as Vec3);
      result.push({ material:'inside', surfaceId:'inside-front', shape:'garment', instanceIndex, localPoints, points:localPoints.map((point) => point.map((value,axis) => value + position[axis]) as Vec3) });
    }
  }
  return result;
}

function dimensionsFor(workspace: ShapeWorkspace, index: number) {
  return workspace.instanceDimensions[index] ?? workspace.dimensions;
}

function positionedSceneFaces(shape: ShapeType, dimensions: Dimensions, instanceDimensions: Dimensions[], lidAngles: number[], crownRoundness: number[], hookEnabled: boolean[], hookSizes: number[], positions: Vec3[], openingsByInstance: GarmentOpening[][] = []): InstanceFace[] {
  return positions.flatMap(([offsetX, offsetY, offsetZ], instanceIndex) => {
    const currentDimensions=instanceDimensions[instanceIndex] ?? dimensions;
    const fit = SHAPE_NORMALIZATION[shape];
    const faces = sceneFaces(shape, currentDimensions, lidAngles[instanceIndex] ?? 0, crownRoundness[instanceIndex] ?? 72, hookEnabled[instanceIndex] ?? false, hookSizes[instanceIndex] ?? 1).map(({ points, material, surfaceId }) => ({
      material,
      surfaceId,
      shape,
      instanceIndex,
      localPoints: points.map(([x,y,z]) => [x / fit, y / fit, z / fit] as Vec3),
      points: points.map(([x,y,z]) => [x / fit + offsetX, y / fit + offsetY, z / fit + offsetZ] as Vec3),
    }));
    return shape === 'garment' ? [...faces,...garmentInteriorFaces(faces,openingsByInstance[instanceIndex] ?? [])] : faces;
  });
}

function groundOffsetFor(shape: ShapeType, dimensions: Dimensions, lidAngle: number) {
  const fit = SHAPE_NORMALIZATION[shape];
  const lowestPoint = Math.min(...sceneFaces(shape, dimensions, lidAngle).flatMap((face) => face.points.map((point) => point[1]))) / fit;
  return GROUND_Y - lowestPoint;
}

function localBoundsFor(shape: ShapeType, dimensions: Dimensions, lidAngle: number, roundness: number, hookEnabled: boolean, hookSize = 1): CollisionBounds {
  const fit = SHAPE_NORMALIZATION[shape];
  const points = sceneFaces(shape, dimensions, lidAngle, roundness, hookEnabled, hookSize).flatMap((face) => face.points);
  return {
    min: ([0, 1, 2] as const).map((axis) => Math.min(...points.map((point) => point[axis])) / fit) as Vec3,
    max: ([0, 1, 2] as const).map((axis) => Math.max(...points.map((point) => point[axis])) / fit) as Vec3,
  };
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

function allSceneFaces(workspaces: Record<ShapeType, ShapeWorkspace>) {
  return SHAPES.flatMap(({ id }) => {
    const workspace = workspaces[id];
    return positionedSceneFaces(id, workspace.dimensions, workspace.instanceDimensions, workspace.lidAngles, workspace.crownRoundness, workspace.hookEnabled, workspace.hookSizes, workspace.positions, workspace.openings);
  });
}

type UnitProjectionBounds = { minX:number; maxX:number; minY:number; maxY:number };

function selectedProjectionBounds(workspaces: Record<ShapeType, ShapeWorkspace>, selectedShape: ShapeType, rotation: { yaw:number; pitch:number }, focalLength: number, width: number, height: number): UnitProjectionBounds | null {
  if (width <= 0 || height <= 0) return null;
  const selectedIndex = workspaces[selectedShape].selectedIndex;
  const scene = allSceneFaces(workspaces);
  const selectedFaces = scene.filter((face) => face.shape === selectedShape && face.instanceIndex === selectedIndex);
  const points = (selectedFaces.length ? selectedFaces : scene).flatMap((face) => face.points).map((point) => rotate(point, rotation.yaw, rotation.pitch));
  if (!points.length) return null;
  const lensRatio = focalLength / 35;
  const cameraDistance = 4.25 * lensRatio;
  const focal = Math.min(width, height) * 1.75 * lensRatio;
  const projected = points.map((point) => {
    const denominator = Math.max(1.2, cameraDistance - point[2]);
    return { x:(point[0] * focal) / denominator, y:-(point[1] * focal) / denominator };
  });
  return {
    minX:Math.min(...projected.map((point) => point.x)),
    maxX:Math.max(...projected.map((point) => point.x)),
    minY:Math.min(...projected.map((point) => point.y)),
    maxY:Math.max(...projected.map((point) => point.y)),
  };
}

function calculateZoomLimit(bounds: UnitProjectionBounds | null, width: number, height: number) {
  if (!bounds || width <= 0 || height <= 0) return 1.72;
  const available = Math.max(40, Math.min(width,height) - CANVAS_EDGE_PADDING * 2);
  const projectedSize = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  return Math.max(.03, Math.min(MAX_ZOOM_SEARCH, available / projectedSize));
}

function clampPanToSquare(pan: { x:number; y:number }, bounds: UnitProjectionBounds | null, zoom: number, width: number, height: number) {
  if (!bounds || width <= 0 || height <= 0) return pan;
  const half = Math.max(20, (Math.min(width,height) - CANVAS_EDGE_PADDING * 2) / 2);
  const minPanX = -half - bounds.minX * zoom;
  const maxPanX = half - bounds.maxX * zoom;
  const minPanY = -half - bounds.minY * zoom;
  const maxPanY = half - bounds.maxY * zoom;
  return {
    x:Math.max(minPanX,Math.min(maxPanX,pan.x)),
    y:Math.max(minPanY,Math.min(maxPanY,pan.y)),
  };
}

function distanceToSegment(point:{x:number;y:number}, start:{x:number;y:number}, end:{x:number;y:number}) {
  const dx=end.x-start.x, dy=end.y-start.y;
  const lengthSquared=dx*dx+dy*dy;
  if (!lengthSquared) return Math.hypot(point.x-start.x,point.y-start.y);
  const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/lengthSquared));
  return Math.hypot(point.x-(start.x+t*dx),point.y-(start.y+t*dy));
}

function sceneObstacles(workspaces: Record<ShapeType, ShapeWorkspace>, excludeShape?: ShapeType, excludeIndex = -1) {
  return SHAPES.flatMap(({ id }) => {
    const workspace = workspaces[id];
    return workspace.positions.flatMap((position, index) => id === excludeShape && index === excludeIndex ? [] : [worldBounds(
      localBoundsFor(id, dimensionsFor(workspace,index), workspace.lidAngles[index] ?? 0, workspace.crownRoundness[index] ?? 72, workspace.hookEnabled[index] ?? false, workspace.hookSizes[index] ?? 1),
      position,
    )]);
  });
}

function collisionSafePositionInScene(shape: ShapeType, workspaces: Record<ShapeType, ShapeWorkspace>, index: number, desiredPosition: Vec3, groundEnabled: boolean) {
  const workspace = workspaces[shape];
  const current = workspace.positions[index] ?? [0, 0, 0];
  const desired = [...desiredPosition] as Vec3;
  const currentDimensions=dimensionsFor(workspace,index);
  if (groundEnabled) desired[1] = Math.max(desired[1], groundOffsetFor(shape, currentDimensions, workspace.lidAngles[index] ?? 0));
  const movingBounds = localBoundsFor(shape, currentDimensions, workspace.lidAngles[index] ?? 0, workspace.crownRoundness[index] ?? 72, workspace.hookEnabled[index] ?? false, workspace.hookSizes[index] ?? 1);
  return resolveCollisionMove(current, desired, movingBounds, sceneObstacles(workspaces, shape, index)) as Vec3;
}

function separateSceneWorkspaces(workspaces: Record<ShapeType, ShapeWorkspace>, groundEnabled: boolean) {
  const placedBounds: CollisionBounds[] = [];
  const next = { ...workspaces };
  SHAPES.forEach(({ id }) => {
    const workspace = next[id];
    const positions = workspace.positions.map((position, index) => {
      const currentDimensions=dimensionsFor(workspace,index);
      const localBounds = localBoundsFor(id, currentDimensions, workspace.lidAngles[index] ?? 0, workspace.crownRoundness[index] ?? 72, workspace.hookEnabled[index] ?? false, workspace.hookSizes[index] ?? 1);
      const baseY = groundEnabled ? groundOffsetFor(id, currentDimensions, workspace.lidAngles[index] ?? 0) : position[1];
      let nextPosition = [position[0], Math.max(position[1], baseY), position[2]] as Vec3;
      if (placedBounds.some((bounds) => boundsOverlap(worldBounds(localBounds, nextPosition), bounds))) nextPosition = spawnBeside(localBounds, placedBounds, baseY, position[2]) as Vec3;
      placedBounds.push(worldBounds(localBounds, nextPosition));
      return nextPosition;
    });
    next[id] = { ...workspace, positions };
  });
  return next;
}

function reindexInstanceRecord<T>(record: Record<string, T>, removedIndex: number) {
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
    const separator = key.indexOf(':');
    const index = Number(key.slice(0, separator));
    if (index === removedIndex) return [];
    if (index < removedIndex) return [[key, value]];
    return [[`${index - 1}${key.slice(separator)}`, value]];
  }));
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
    'fixed-slope':'固定前斜面',
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

function tracePolygon(ctx: CanvasRenderingContext2D, polygon: { x: number; y: number }[]) {
  polygon.forEach((point,index) => index === 0 ? ctx.moveTo(point.x,point.y) : ctx.lineTo(point.x,point.y));
  ctx.closePath();
}

function traceFaceWithHoles(ctx: CanvasRenderingContext2D, polygon: { x: number; y: number }[], holes: { x: number; y: number }[][]) {
  ctx.beginPath();
  tracePolygon(ctx,polygon);
  holes.forEach((hole) => tracePolygon(ctx,hole));
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
  const { width, height } = scaledDecalDimensions(decal.width, decal.height, decal.scale);
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

function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>, hitRegionsRef: React.MutableRefObject<HitRegion[]>, faceRegionsRef: React.MutableRefObject<FaceHitRegion[]>, openingRegionsRef: React.MutableRefObject<OpeningHitRegion[]>, gizmoHitRegionsRef: React.MutableRefObject<GizmoHitRegion[]> | null, gizmoVisible: boolean, drawSceneRef: React.MutableRefObject<((cleanCapture?: boolean) => void) | null>, selectedShape: ShapeType, workspaces: Record<ShapeType, ShapeWorkspace>, rotation: { yaw: number; pitch: number }, pan: { x: number; y: number }, zoom: number, gridVisible: boolean, groundEnabled: boolean, focalLength: number, materialPickerEnabled: boolean, openingPickerEnabled: boolean, canvasProjection: CanvasProjection = 'perspective') {
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
      const scene = allSceneFaces(workspaces);
      const selectedWorkspace = workspaces[selectedShape];
      const lensRatio = focalLength / 35;
      const cameraDistance = 4.25 * lensRatio;
      const focal = Math.min(w, h) * 1.75 * lensRatio;
      const orthographicScale = Math.min(w, h) * .42 * zoom;
      const centerX = w / 2 + pan.x, centerY = h / 2 - 5 + pan.y;
      const project = (v: Vec3) => {
        if (canvasProjection === 'orthographic') return { x:centerX + v[0] * orthographicScale, y:centerY - v[1] * orthographicScale, z:v[2] };
        const denominator = Math.max(1.2, cameraDistance - v[2]);
        return { x: centerX + (v[0] * focal * zoom) / denominator, y: centerY - (v[1] * focal * zoom) / denominator, z: v[2] };
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
      const instanceProjected = new Map<string, { x: number; y: number }[]>();
      const localBoundsByInstance = scene.reduce((bounds, face) => {
        const key = `${face.shape}:${face.instanceIndex}`;
        const current = bounds.get(key) ?? { min:[Infinity,Infinity,Infinity] as Vec3, max:[-Infinity,-Infinity,-Infinity] as Vec3 };
        face.localPoints.forEach((point) => point.forEach((value, axis) => { current.min[axis] = Math.min(current.min[axis], value); current.max[axis] = Math.max(current.max[axis], value); }));
        bounds.set(key, current);
        return bounds;
      }, new Map<string, ProjectionBounds>());
      const garmentWorkspace = workspaces.garment;
      const openingWorldContours = garmentWorkspace.openings.map((items,instanceIndex) => {
        const instanceFaces=scene.filter((face)=>face.shape==='garment'&&face.instanceIndex===instanceIndex);
        const sideFaces=instanceFaces.filter((face)=>face.surfaceId==='side').map((face)=>face.points);
        return items.map((opening) => {
          const panel=instanceFaces.find((face)=>face.surfaceId===opening.surfaceId);
          const points=opening.surfaceId==='side' ? openingContourOnSide(opening,sideFaces) : panel ? openingContourOnFace(opening,panel.points) : [];
          return { opening,points };
        });
      });
      const visibleFaces = scene.map(({ points, localPoints, material, shape, instanceIndex, surfaceId }) => {
        const transformed = points.map((point) => rotate(point, rotation.yaw, rotation.pitch));
        const projected = transformed.map(project);
        const faceOpenings = shape === 'garment' && (surfaceId === 'front' || surfaceId === 'back' || surfaceId === 'side') ? (openingWorldContours[instanceIndex] ?? []).filter(({ opening }) => opening.surfaceId === surfaceId) : [];
        const openingContours = faceOpenings.map(({ opening,points:openingPoints }) => ({ opening, polygon:openingPoints.map((point) => project(rotate(point,rotation.yaw,rotation.pitch))) }));
        const instanceKey = `${shape}:${instanceIndex}`;
        instanceProjected.set(instanceKey, [...(instanceProjected.get(instanceKey) ?? []), ...projected]);
        const p0 = transformed[0], p1 = transformed[1], p2 = transformed[2];
        const u: Vec3 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        const v: Vec3 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        const normal: Vec3 = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const length = Math.hypot(...normal) || 1;
        const shade = Math.max(0, (normal[0]*light[0] + normal[1]*light[1] + normal[2]*light[2]) / length);
        return { projected, localPoints, depth: transformed.reduce((sum, point) => sum + point[2], 0) / transformed.length, shade, material, shape, instanceIndex, surfaceId, openingContours };
      }).sort((a, b) => a.depth - b.depth);
      ctx.lineJoin = "round";
      const patternCache = new Map<string, { image: HTMLImageElement; pattern: CanvasPattern }>();
      for (const { projected, localPoints, shade, material, shape, instanceIndex, surfaceId, openingContours } of visibleFaces) {
        const workspace = workspaces[shape];
        const assignedMaterial = workspace.faceMaterials[faceMaterialKey(instanceIndex, surfaceId)];
        const assignedDecal = workspace.decals[faceMaterialKey(instanceIndex, surfaceId)];
        const image = assignedMaterial ? textureImage(assignedMaterial.src, draw) : null;
        const decalImage = assignedDecal ? textureImage(assignedDecal.src, draw) : null;
        const modelColor = workspace.colors[instanceIndex] ?? '#ee6a35';
        const holePolygons = openingContours.map(({ polygon }) => polygon);
        ctx.save();
        ctx.beginPath(); tracePolygon(ctx,projected); ctx.clip();
        traceFaceWithHoles(ctx,projected,holePolygons);
        ctx.clip('evenodd');
        if (assignedMaterial && image) {
          let cached = patternCache.get(assignedMaterial.src);
          if (!cached) {
            const pattern = ctx.createPattern(image, 'repeat');
            if (pattern) { cached = { image, pattern }; patternCache.set(assignedMaterial.src, cached); }
          }
          if (cached) fillProjectedTexture(ctx, cached.pattern, cached.image, localPoints, projected, assignedMaterial, surfaceId, localBoundsByInstance.get(`${shape}:${instanceIndex}`)!);
          ctx.fillStyle = `rgba(16,23,31,${Math.max(.04, .2 - shade * .13)})`;
          ctx.fillRect(0,0,w,h);
        } else {
          ctx.fillStyle = material === "hook" ? `hsl(215 9% ${34 + shade * 42}%)` : material === "trim" ? shadedModelColor(modelColor, .67 + shade * .28) : material === "inside" ? shadedModelColor(modelColor, .32 + shade * .12) : material === "lid" ? shadedModelColor(modelColor, .82 + shade * .28) : shadedModelColor(modelColor, .7 + shade * .32);
          ctx.fillRect(0,0,w,h);
        }
        if (assignedDecal && decalImage) {
          fillProjectedDecal(ctx, decalImage, localPoints, projected, assignedDecal, surfaceId, localBoundsByInstance.get(`${shape}:${instanceIndex}`)!);
        }
        ctx.restore();
        ctx.beginPath(); tracePolygon(ctx,projected);
        ctx.strokeStyle = material === "inside" ? "rgba(255,255,255,.08)" : material === "hook" ? "rgba(24,33,45,.48)" : material === "lid" ? "rgba(90,34,12,.38)" : "rgba(68,28,12,.22)";
        ctx.lineWidth = material === "lid" ? 1 : .75;
        ctx.stroke();
        if (holePolygons.length) {
          holePolygons.forEach((hole) => { ctx.beginPath(); tracePolygon(ctx,hole); ctx.strokeStyle='rgba(36,25,21,.68)'; ctx.lineWidth=1.25; ctx.stroke(); });
        }
        if (!cleanCapture && shape === selectedShape && instanceIndex === selectedWorkspace.selectedIndex) {
          ctx.save();
          traceFaceWithHoles(ctx,projected,holePolygons);
          ctx.fillStyle = 'rgba(255,184,112,.28)';
          ctx.fill('evenodd');
          ctx.beginPath(); tracePolygon(ctx,projected);
          ctx.strokeStyle = 'rgba(225,83,27,.78)';
          ctx.lineWidth = 1.15;
          ctx.stroke();
          ctx.restore();
        }
        if (!cleanCapture && materialPickerEnabled && shape === selectedShape && instanceIndex === selectedWorkspace.selectedIndex && selectedWorkspace.selectedSurfaceIds.includes(surfaceId)) {
          ctx.save(); ctx.beginPath(); tracePolygon(ctx,projected); ctx.clip(); traceFaceWithHoles(ctx,projected,holePolygons); ctx.clip('evenodd'); ctx.fillStyle = "rgba(238,106,53,.18)"; ctx.fillRect(0,0,w,h); ctx.restore();
          ctx.beginPath(); tracePolygon(ctx,projected);
          ctx.strokeStyle = "rgba(217,81,29,.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (!cleanCapture && openingPickerEnabled && shape === 'garment' && selectedShape === 'garment' && instanceIndex === selectedWorkspace.selectedIndex && openingContours.some(({ opening }) => opening.id === selectedWorkspace.selectedOpeningId)) {
          openingContours.filter(({ opening }) => opening.id === selectedWorkspace.selectedOpeningId).forEach(({ polygon }) => { ctx.save(); ctx.beginPath(); tracePolygon(ctx,polygon); ctx.fillStyle='rgba(129,92,179,.18)'; ctx.fill(); ctx.strokeStyle='rgba(105,70,153,.95)'; ctx.lineWidth=2; ctx.setLineDash([5,3]); ctx.stroke(); ctx.restore(); });
        }
      }
      faceRegionsRef.current = visibleFaces.map(({ shape, instanceIndex, surfaceId, projected, openingContours }) => ({ shape, instanceIndex, surfaceId, polygon: projected, holes:openingContours.map(({ polygon })=>polygon) }));
      openingRegionsRef.current = visibleFaces.flatMap(({ shape, instanceIndex, openingContours }) => openingContours.map(({ opening,polygon }) => ({ shape, instanceIndex, openingId:opening.id, surfaceId:opening.surfaceId, polygon })));
      const regions = [...instanceProjected.entries()].map(([key, points]) => {
        const [regionShape, indexText] = key.split(':') as [ShapeType,string];
        const index = Number(indexText);
        const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
        return { shape:regionShape, index, x: (left + right) / 2, y: (top + bottom) / 2, radius: Math.max(26, Math.hypot(right-left, bottom-top) / 2) };
      });
      hitRegionsRef.current = regions;
      if (!cleanCapture && canvasProjection === 'perspective' && gizmoHitRegionsRef && gizmoVisible && selectedWorkspace.positions.length) {
        const selectedFaces=scene.filter((face)=>face.shape===selectedShape&&face.instanceIndex===selectedWorkspace.selectedIndex);
        const selectedPoints=selectedFaces.flatMap((face)=>face.points);
        if (selectedPoints.length) {
          const anchor=([0,1,2] as const).map((axis)=>(Math.min(...selectedPoints.map((point)=>point[axis]))+Math.max(...selectedPoints.map((point)=>point[axis])))/2) as Vec3;
          const origin=project(rotate(anchor,rotation.yaw,rotation.pitch));
          const axes:[GizmoAxis,Vec3,string,string][]=[
            ['x',[1,0,0],'#ef4444','X'],
            ['y',[0,1,0],'#22a35a','Y'],
            ['z',[0,0,1],'#3478f6','Z'],
          ];
          const fallback:Record<GizmoAxis,{x:number;y:number}>={x:{x:1,y:0},y:{x:0,y:-1},z:{x:-.72,y:.69}};
          gizmoHitRegionsRef.current=axes.map(([axis,vector,color,label])=>{
            const worldEnd=anchor.map((value,index)=>value+vector[index]*.42) as Vec3;
            const projectedEnd=project(rotate(worldEnd,rotation.yaw,rotation.pitch));
            const raw={x:projectedEnd.x-origin.x,y:projectedEnd.y-origin.y};
            const rawLength=Math.hypot(raw.x,raw.y);
            const direction=rawLength>.08?{x:raw.x/rawLength,y:raw.y/rawLength}:fallback[axis];
            const start={x:origin.x+direction.x*9,y:origin.y+direction.y*9};
            const end={x:origin.x+direction.x*70,y:origin.y+direction.y*70};
            ctx.save();
            ctx.lineCap='round';
            ctx.strokeStyle='rgba(255,255,255,.92)';
            ctx.lineWidth=6;
            ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
            ctx.strokeStyle=color;
            ctx.lineWidth=3;
            ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
            const perpendicular={x:-direction.y,y:direction.x};
            ctx.fillStyle=color;
            ctx.beginPath();ctx.moveTo(end.x+direction.x*7,end.y+direction.y*7);ctx.lineTo(end.x-direction.x*7+perpendicular.x*5,end.y-direction.y*7+perpendicular.y*5);ctx.lineTo(end.x-direction.x*7-perpendicular.x*5,end.y-direction.y*7-perpendicular.y*5);ctx.closePath();ctx.fill();
            ctx.font='700 11px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(end.x+direction.x*16,end.y+direction.y*16,9,0,Math.PI*2);ctx.fill();
            ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle=color;ctx.fillText(label,end.x+direction.x*16,end.y+direction.y*16+.5);
            ctx.restore();
            return {shape:selectedShape,index:selectedWorkspace.selectedIndex,axis,start,end:{x:end.x+direction.x*9,y:end.y+direction.y*9},direction};
          });
          ctx.save();ctx.fillStyle='#ffffff';ctx.strokeStyle='rgba(55,65,81,.45)';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(origin.x,origin.y,6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
        } else gizmoHitRegionsRef.current=[];
      } else if (!cleanCapture && gizmoHitRegionsRef) gizmoHitRegionsRef.current=[];
    };
    drawSceneRef.current = draw;
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => { observer.disconnect(); drawSceneRef.current = null; };
  }, [canvasRef, hitRegionsRef, faceRegionsRef, openingRegionsRef, gizmoHitRegionsRef, gizmoVisible, drawSceneRef, selectedShape, workspaces, rotation, pan, zoom, gridVisible, groundEnabled, focalLength, materialPickerEnabled, openingPickerEnabled, canvasProjection]);
}

function DimensionControl({ label, axis, value, unit, minValue, maxValue, onChange }: { label: string; axis: string; value: number; unit: string; minValue?: number; maxValue?: number; onChange: (value: number) => void }) {
  const min = minValue ?? (unit === "%" ? 10 : .5), max = maxValue ?? (unit === "%" ? 500 : 10), step = unit === "%" ? 1 : .1;
  return <div className="dimension-control">
    <div className="control-heading"><span><b className={`axis axis-${axis.toLowerCase()}`}>{axis}</b>{label}</span><label className="value-field"><input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} /><span>{unit}</span></label></div>
    <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)} />
  </div>;
}

const ORTHOGRAPHIC_VIEWS: Record<OrthographicView, { label: string; eyebrow: string; axes: string; rotation: { yaw: number; pitch: number } }> = {
  front: { label:'正视图', eyebrow:'FRONT', axes:'X / Y', rotation:{ yaw:0, pitch:0 } },
  top: { label:'顶视图', eyebrow:'TOP', axes:'X / Z', rotation:{ yaw:0, pitch:-Math.PI / 2 } },
  right: { label:'右视图', eyebrow:'RIGHT', axes:'Z / Y', rotation:{ yaw:Math.PI / 2, pitch:0 } },
};

function OrthographicViewport({ view, selectedShape, workspaces, gridVisible, groundEnabled, onSelect, onMove }: {
  view: OrthographicView;
  selectedShape: ShapeType;
  workspaces: Record<ShapeType, ShapeWorkspace>;
  gridVisible: boolean;
  groundEnabled: boolean;
  onSelect: (shape: ShapeType, index: number) => void;
  onMove: (shape: ShapeType, index: number, delta: Vec3) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const faceRegionsRef = useRef<FaceHitRegion[]>([]);
  const openingRegionsRef = useRef<OpeningHitRegion[]>([]);
  const drawSceneRef = useRef<((cleanCapture?: boolean) => void) | null>(null);
  const pointerRef = useRef<{ id:number; x:number; y:number; action:'object'|'pan'; objectShape:ShapeType; objectIndex:number } | null>(null);
  const [pan, setPan] = useState({ x:0, y:0 });
  const [zoom, setZoom] = useState(.82);
  const config = ORTHOGRAPHIC_VIEWS[view];

  useCanvasRenderer(canvasRef, hitRegionsRef, faceRegionsRef, openingRegionsRef, null, false, drawSceneRef, selectedShape, workspaces, config.rotation, pan, zoom, gridVisible, groundEnabled, 35, false, false, 'orthographic');

  const reset = () => { setPan({ x:0, y:0 }); setZoom(.82); };
  return <div className="ortho-card" data-view={view}>
    <canvas ref={canvasRef} tabIndex={0} aria-label={`${config.label}，拖动模型调整 ${config.axes} 位置，中键平移，滚轮缩放`}
      onPointerDown={(event) => {
        event.preventDefault();
        const rect=event.currentTarget.getBoundingClientRect();
        const x=event.clientX-rect.left, y=event.clientY-rect.top;
        if(event.button===1){
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerRef.current={ id:event.pointerId,x:event.clientX,y:event.clientY,action:'pan',objectShape:selectedShape,objectIndex:-1 };
          event.currentTarget.classList.add('is-panning');
          return;
        }
        if(event.button!==0) return;
        const hit=[...hitRegionsRef.current].sort((a,b)=>a.radius-b.radius).find((region)=>Math.hypot(x-region.x,y-region.y)<=region.radius+8);
        if(!hit) return;
        onSelect(hit.shape,hit.index);
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerRef.current={ id:event.pointerId,x:event.clientX,y:event.clientY,action:'object',objectShape:hit.shape,objectIndex:hit.index };
        event.currentTarget.classList.add('is-moving-object');
      }}
      onPointerMove={(event) => {
        const pointer=pointerRef.current;
        if(!pointer||pointer.id!==event.pointerId) return;
        const dx=event.clientX-pointer.x, dy=event.clientY-pointer.y;
        if(pointer.action==='pan') setPan((current)=>({ x:current.x+dx,y:current.y+dy }));
        else {
          const scale=Math.max(32,Math.min(event.currentTarget.clientWidth,event.currentTarget.clientHeight)*.42*zoom);
          const horizontal=dx/scale, vertical=-dy/scale;
          const delta:Vec3=view==='front'?[horizontal,vertical,0]:view==='top'?[horizontal,0,vertical]:[0,vertical,horizontal];
          onMove(pointer.objectShape,pointer.objectIndex,delta);
        }
        pointerRef.current={ ...pointer,x:event.clientX,y:event.clientY };
      }}
      onPointerUp={(event)=>{ pointerRef.current=null; event.currentTarget.classList.remove('is-moving-object','is-panning'); }}
      onPointerCancel={(event)=>{ pointerRef.current=null; event.currentTarget.classList.remove('is-moving-object','is-panning'); }}
      onAuxClick={(event)=>event.preventDefault()}
      onDoubleClick={reset}
      onWheel={(event)=>{ event.preventDefault(); setZoom((current)=>Math.max(.45,Math.min(3.4,current-event.deltaY*.0014))); }} />
    <div className="ortho-title"><span>{config.eyebrow}</span><strong>{config.label}</strong></div>
    <div className="ortho-axes">{config.axes}</div>
    <div className="ortho-help">拖动定位</div>
  </div>;
}

export default function ShapeStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const faceRegionsRef = useRef<FaceHitRegion[]>([]);
  const openingRegionsRef = useRef<OpeningHitRegion[]>([]);
  const gizmoHitRegionsRef = useRef<GizmoHitRegion[]>([]);
  const [gizmoVisible, setGizmoVisible] = useState(false);
  const drawSceneRef = useRef<((cleanCapture?: boolean) => void) | null>(null);
  const pointerRef = useRef<CanvasPointerState | null>(null);
  const lidAnimationRef = useRef<number | null>(null);
  const [shape, setShape] = useState<ShapeType>("garment");
  const isGarment = shape === "garment";
  const [workspaces, setWorkspaces] = useState<Record<ShapeType, ShapeWorkspace>>({
    garment: { dimensions: { width: 1, height: 1, depth: 1, scale: 1 }, instanceDimensions:[], positions: [], lidAngles: [], crownRoundness: [], hookEnabled: [], hookSizes: [], colors: [], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {}, openings:[], selectedOpeningId:null, openingSurfaceId:'front' },
    box: { dimensions: { width: 4, height: 3, depth: 2.5, scale: 1 }, instanceDimensions:[], positions: [], lidAngles: [], crownRoundness: [], hookEnabled: [], hookSizes: [], colors: [], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {}, openings:[], selectedOpeningId:null, openingSurfaceId:'front' },
    cylinder: { dimensions: { width: 3, height: 4, depth: 3, scale: 1 }, instanceDimensions:[], positions: [], lidAngles: [], crownRoundness: [], hookEnabled: [], hookSizes: [], colors: [], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {}, openings:[], selectedOpeningId:null, openingSurfaceId:'front' },
    trapezoid: { dimensions: { width: 5.6, height: 3.2, depth: 5, scale: 1 }, instanceDimensions:[], positions: [], lidAngles: [], crownRoundness: [], hookEnabled: [], hookSizes: [], colors: [], selectedIndex: 0, selectedSurfaceIds: [], faceMaterials: {}, decals: {}, openings:[], selectedOpeningId:null, openingSurfaceId:'front' },
  });
  const [rotation, setRotation] = useState({ yaw: -.62, pitch: -.38 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomLimit, setZoomLimit] = useState(1.72);
  const [gridVisible, setGridVisible] = useState(true);
  const [groundEnabled, setGroundEnabled] = useState(false);
  const [focalLength, setFocalLength] = useState(35);
  const [captureStatus, setCaptureStatus] = useState(false);
  const [threeViewEnabled, setThreeViewEnabled] = useState(false);
  const [materialPickerEnabled, setMaterialPickerEnabled] = useState(false);
  const [openingPickerEnabled, setOpeningPickerEnabled] = useState(false);
  const [newMaterialProjection, setNewMaterialProjection] = useState<ProjectionMode>('cube');
  const [newOpeningShape, setNewOpeningShape] = useState<OpeningShape>('rounded-rectangle');
  const activeWorkspace=workspaces[shape];
  const { positions, lidAngles, crownRoundness, hookEnabled, hookSizes, colors, selectedIndex, selectedSurfaceIds, faceMaterials, decals, openings, selectedOpeningId, openingSurfaceId } = activeWorkspace;
  const dimensions=dimensionsFor(activeWorkspace,selectedIndex);
  const quantity = positions.length;
  const totalQuantity = SHAPES.reduce((sum, item) => sum + workspaces[item.id].positions.length, 0);
  const hasSelectedModel = quantity > 0;
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
  const currentOpenings = openings[selectedIndex] ?? [];
  const selectedOpening = currentOpenings.find((opening) => opening.id === selectedOpeningId) ?? null;
  const groundMinY = groundOffsetFor(shape, dimensions, selectedLidAngle);
  useCanvasRenderer(canvasRef, hitRegionsRef, faceRegionsRef, openingRegionsRef, gizmoHitRegionsRef, gizmoVisible, drawSceneRef, shape, workspaces, rotation, pan, zoom, gridVisible, groundEnabled, focalLength, materialPickerEnabled, openingPickerEnabled);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateLimit = () => {
      const bounds = selectedProjectionBounds(workspaces,shape,rotation,focalLength,canvas.clientWidth,canvas.clientHeight);
      const nextLimit = calculateZoomLimit(bounds,canvas.clientWidth,canvas.clientHeight);
      setZoomLimit(nextLimit);
      setZoom((current) => {
        const next = Math.min(current,nextLimit);
        setPan((position) => clampPanToSquare(position,bounds,next,canvas.clientWidth,canvas.clientHeight));
        return next;
      });
    };
    updateLimit();
    const observer = new ResizeObserver(updateLimit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [workspaces,shape,rotation,focalLength]);
  const updateWorkspace = useCallback((targetShape: ShapeType, updater: (workspace: ShapeWorkspace) => ShapeWorkspace) => {
    setWorkspaces((current) => ({ ...current, [targetShape]: updater(current[targetShape]) }));
  }, []);
  const changeDimension = useCallback((key: keyof Dimensions, value: number) => {
    setWorkspaces((current) => {
      const workspace = current[shape];
      const targetIndex=workspace.selectedIndex;
      const previousDimensions=dimensionsFor(workspace,targetIndex);
      const nextDimensions = { ...previousDimensions, [key]: value };
      const resized = { ...workspace,
        instanceDimensions:workspace.instanceDimensions.map((item,index)=>index===targetIndex?nextDimensions:item),
        positions: workspace.positions.map(([x,y,z], index) => {
          if (!groundEnabled || index!==targetIndex) return [x,y,z] as Vec3;
          const oldGroundY = groundOffsetFor(shape, previousDimensions, workspace.lidAngles[index] ?? 0);
          const nextGroundY = groundOffsetFor(shape, nextDimensions, workspace.lidAngles[index] ?? 0);
          return [x, Math.abs(y-oldGroundY)<.02 ? nextGroundY : Math.max(y,nextGroundY), z] as Vec3;
        }) };
      return separateSceneWorkspaces({ ...current, [shape]: resized }, groundEnabled);
    });
  }, [shape, groundEnabled]);
  const selectInstance = (targetShape: ShapeType, index: number) => {
    setGizmoVisible(false);
    setShape(targetShape);
    updateWorkspace(targetShape, (workspace) => ({ ...workspace, selectedIndex: index, selectedSurfaceIds: [], selectedOpeningId:null }));
  };
  const moveInstanceByDelta = useCallback((targetShape: ShapeType, targetIndex: number, delta: Vec3) => {
    setWorkspaces((currentWorkspaces) => {
      const workspace=currentWorkspaces[targetShape];
      const current=workspace.positions[targetIndex];
      if(!current) return currentWorkspaces;
      const desired=current.map((value,axis)=>value+delta[axis]) as Vec3;
      const resolved=collisionSafePositionInScene(targetShape,currentWorkspaces,targetIndex,desired,groundEnabled);
      return { ...currentWorkspaces,[targetShape]:{ ...workspace,positions:workspace.positions.map((position,index)=>index===targetIndex?resolved:position) } };
    });
  },[groundEnabled]);
  const addShapeInstance = (targetShape: ShapeType) => {
    setGizmoVisible(false);
    setShape(targetShape);
    setMaterialPickerEnabled(false);
    setOpeningPickerEnabled(false);
    setWorkspaces((current) => {
      const workspace = current[targetShape];
      if (workspace.positions.length >= 12) return current;
      const index = workspace.positions.length;
      const lidAngle = 0;
      const roundness = targetShape === 'garment' ? 72 : 0;
      const newDimensions={ ...(index ? dimensionsFor(workspace,workspace.selectedIndex) : workspace.dimensions) };
      const localBounds = localBoundsFor(targetShape, newDimensions, lidAngle, roundness, false, 1);
      const baseY = groundEnabled ? groundOffsetFor(targetShape, newDimensions, lidAngle) : 0;
      const position = spawnBeside(localBounds, sceneObstacles(current), baseY, 0) as Vec3;
      return {
        ...current,
        [targetShape]: {
          ...workspace,
          instanceDimensions:[...workspace.instanceDimensions,newDimensions], positions:[...workspace.positions,position], lidAngles:[...workspace.lidAngles,lidAngle], crownRoundness:[...workspace.crownRoundness,roundness],
          hookEnabled:[...workspace.hookEnabled,false], hookSizes:[...workspace.hookSizes,1], colors:[...workspace.colors,'#ee6a35'], openings:[...workspace.openings,[]],
          selectedIndex:index, selectedSurfaceIds:[], selectedOpeningId:null,
        },
      };
    });
  };
  const toggleGround = () => {
    if (groundEnabled) { setGroundEnabled(false); return; }
    setWorkspaces((current) => {
      const grounded=Object.fromEntries(SHAPES.map(({id})=>[id,{ ...current[id],positions:current[id].positions.map(([x,,z],index)=>[x,groundOffsetFor(id,dimensionsFor(current[id],index),current[id].lidAngles[index] ?? 0),z] as Vec3) }])) as Record<ShapeType,ShapeWorkspace>;
      return separateSceneWorkspaces(grounded, true);
    });
    setGroundEnabled(true);
  };
  const changeQuantity = (nextQuantity: number) => {
    const next = Math.max(1, Math.min(12, Math.round(nextQuantity)));
    setWorkspaces((current) => {
      const workspace = current[shape];
      if (next <= workspace.positions.length) return { ...current, [shape]: {
          ...workspace,
          instanceDimensions:workspace.instanceDimensions.slice(0,next), positions: workspace.positions.slice(0, next), lidAngles: workspace.lidAngles.slice(0, next), crownRoundness: workspace.crownRoundness.slice(0, next),
          hookEnabled: workspace.hookEnabled.slice(0, next), hookSizes: workspace.hookSizes.slice(0, next), colors: workspace.colors.slice(0, next), openings: workspace.openings.slice(0,next),
          faceMaterials: Object.fromEntries(Object.entries(workspace.faceMaterials).filter(([key]) => Number(key.split(':')[0]) < next)),
          decals: Object.fromEntries(Object.entries(workspace.decals).filter(([key]) => Number(key.split(':')[0]) < next)), selectedIndex: Math.min(next - 1, workspace.selectedIndex), selectedSurfaceIds: [], selectedOpeningId:null,
        } };
      const nextPositions = [...workspace.positions];
      const nextInstanceDimensions=workspace.instanceDimensions.map((item)=>({ ...item }));
      const nextLidAngles = [...workspace.lidAngles];
      const nextRoundness = [...workspace.crownRoundness];
      const nextHookEnabled = [...workspace.hookEnabled];
      const nextHookSizes = [...workspace.hookSizes];
      const nextColors = [...workspace.colors];
      const nextOpenings = workspace.openings.map((items) => [...items]);
      const templateIndex = workspace.selectedIndex;
      let nextFaceMaterials = { ...workspace.faceMaterials };
      let nextDecals = { ...workspace.decals };
      while (nextPositions.length < next) {
        const index = nextPositions.length;
        const lidAngle = workspace.lidAngles[templateIndex] ?? 0;
        const roundness = workspace.crownRoundness[templateIndex] ?? 72;
        const hasHook = workspace.hookEnabled[templateIndex] ?? false;
        const hookSize = workspace.hookSizes[templateIndex] ?? 1;
        const templateDimensions={ ...dimensionsFor(workspace,templateIndex) };
        const localBounds = localBoundsFor(shape, templateDimensions, lidAngle, roundness, hasHook, hookSize);
        const sameShapeObstacles = nextPositions.map((position, obstacleIndex) => worldBounds(
          localBoundsFor(shape, nextInstanceDimensions[obstacleIndex] ?? workspace.dimensions, nextLidAngles[obstacleIndex] ?? 0, nextRoundness[obstacleIndex] ?? 72, nextHookEnabled[obstacleIndex] ?? false, nextHookSizes[obstacleIndex] ?? 1),
          position,
        ));
        const baseY = groundEnabled ? groundOffsetFor(shape, templateDimensions, lidAngle) : 0;
        const otherShapeObstacles = SHAPES.filter(({ id }) => id !== shape).flatMap(({ id }) => {
          const other = current[id];
          return other.positions.map((position, obstacleIndex) => worldBounds(localBoundsFor(id, dimensionsFor(other,obstacleIndex), other.lidAngles[obstacleIndex] ?? 0, other.crownRoundness[obstacleIndex] ?? 72, other.hookEnabled[obstacleIndex] ?? false, other.hookSizes[obstacleIndex] ?? 1), position));
        });
        nextPositions.push(spawnBeside(localBounds, [...otherShapeObstacles,...sameShapeObstacles], baseY, 0) as Vec3);
        nextInstanceDimensions.push(templateDimensions);
        nextLidAngles.push(lidAngle);
        nextRoundness.push(roundness);
        nextHookEnabled.push(hasHook);
        nextHookSizes.push(hookSize);
        nextColors.push(workspace.colors[templateIndex] ?? '#ee6a35');
        nextOpenings.push((workspace.openings[templateIndex] ?? []).map((opening) => ({ ...opening, id:`opening-${Date.now()}-${index}-${Math.random().toString(36).slice(2,7)}` })));
        nextFaceMaterials = cloneInstanceMaterials(nextFaceMaterials, templateIndex, index);
        nextDecals = cloneInstanceMaterials(nextDecals, templateIndex, index);
        if (index >= 11) break;
      }
      return { ...current, [shape]: { ...workspace, instanceDimensions:nextInstanceDimensions, positions: nextPositions, lidAngles: nextLidAngles, crownRoundness: nextRoundness, hookEnabled: nextHookEnabled, hookSizes: nextHookSizes, colors: nextColors, openings:nextOpenings, faceMaterials: nextFaceMaterials, decals: nextDecals, selectedIndex: workspace.selectedIndex } };
    });
  };
  const changePosition = (axis: 0 | 1 | 2, value: number) => {
    setWorkspaces((currentWorkspaces) => {
      const workspace = currentWorkspaces[shape];
      const current = workspace.positions[workspace.selectedIndex];
      if (!current) return currentWorkspaces;
      const desired = current.map((item, itemIndex) => itemIndex === axis ? value : item) as Vec3;
      const resolved = collisionSafePositionInScene(shape, currentWorkspaces, workspace.selectedIndex, desired, groundEnabled);
      return { ...currentWorkspaces, [shape]: { ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? resolved : position) } };
    });
  };
  const resetSelectedPosition = () => setWorkspaces((currentWorkspaces) => {
    const workspace = currentWorkspaces[shape];
    if (!workspace.positions[workspace.selectedIndex]) return currentWorkspaces;
    const desired = [0, groundEnabled ? groundOffsetFor(shape,dimensionsFor(workspace,workspace.selectedIndex),workspace.lidAngles[workspace.selectedIndex] ?? 0) : 0, 0] as Vec3;
    const resolved = collisionSafePositionInScene(shape, currentWorkspaces, workspace.selectedIndex, desired, groundEnabled);
    return { ...currentWorkspaces, [shape]: { ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? resolved : position) } };
  });
  const resetSelectedGarmentDimensions = () => setWorkspaces((currentWorkspaces) => {
    const workspace=currentWorkspaces.garment;
    const resetDimensions={ width:1,height:1,depth:1,scale:1 };
    const targetIndex=workspace.selectedIndex;
    const nextWorkspace={ ...workspace,
      instanceDimensions:workspace.instanceDimensions.map((item,index)=>index===targetIndex?resetDimensions:item),
      positions:workspace.positions.map(([x,y,z],index)=>index===targetIndex?[x,groundEnabled?groundOffsetFor('garment',resetDimensions,workspace.lidAngles[index]??0):y,z] as Vec3:[x,y,z] as Vec3),
    };
    return separateSceneWorkspaces({ ...currentWorkspaces,garment:nextWorkspace },groundEnabled);
  });
  const removeSelectedModel = () => {
    setGizmoVisible(false);
    const removedShape = shape;
    const removedIndex = selectedIndex;
    const nextWorkspace = workspaces[removedShape];
    const remainingInType = nextWorkspace.positions.length - 1;
    const fallbackShape = remainingInType > 0 ? removedShape : SHAPES.find(({ id }) => id !== removedShape && workspaces[id].positions.length > 0)?.id ?? removedShape;
    setWorkspaces((current) => {
      const workspace = current[removedShape];
      return { ...current, [removedShape]: {
        ...workspace,
        instanceDimensions:workspace.instanceDimensions.filter((_,index)=>index!==removedIndex), positions:workspace.positions.filter((_,index)=>index!==removedIndex), lidAngles:workspace.lidAngles.filter((_,index)=>index!==removedIndex), crownRoundness:workspace.crownRoundness.filter((_,index)=>index!==removedIndex),
        hookEnabled:workspace.hookEnabled.filter((_,index)=>index!==removedIndex), hookSizes:workspace.hookSizes.filter((_,index)=>index!==removedIndex), colors:workspace.colors.filter((_,index)=>index!==removedIndex), openings:workspace.openings.filter((_,index)=>index!==removedIndex),
        faceMaterials:reindexInstanceRecord(workspace.faceMaterials,removedIndex), decals:reindexInstanceRecord(workspace.decals,removedIndex),
        selectedIndex:Math.max(0,Math.min(removedIndex,workspace.positions.length-2)), selectedSurfaceIds:[], selectedOpeningId:null,
      } };
    });
    setShape(fallbackShape);
    setMaterialPickerEnabled(false);
    setOpeningPickerEnabled(false);
  };
  const changeSelectedLid = (angle: number) => setWorkspaces((current) => {
    const workspace=current[shape];
    const updated={ ...workspace, lidAngles:workspace.lidAngles.map((value,index)=>index===workspace.selectedIndex?angle:value), positions:workspace.positions.map(([x,y,z],index)=>index===workspace.selectedIndex&&groundEnabled?[x,Math.max(y,groundOffsetFor(shape,dimensionsFor(workspace,index),angle)),z] as Vec3:[x,y,z] as Vec3) };
    return separateSceneWorkspaces({ ...current, [shape]:updated },groundEnabled);
  });
  const changeSelectedRoundness = (roundness: number) => setWorkspaces((current) => {
    const workspace=current.garment;
    return separateSceneWorkspaces({ ...current, garment:{ ...workspace, crownRoundness:workspace.crownRoundness.map((value,index)=>index===workspace.selectedIndex?roundness:value) } },groundEnabled);
  });
  const toggleSelectedHook = () => setWorkspaces((current) => {
    const workspace=current.garment;
    return separateSceneWorkspaces({ ...current, garment:{ ...workspace, hookEnabled:workspace.hookEnabled.map((value,index)=>index===workspace.selectedIndex?!value:value) } },groundEnabled);
  });
  const changeSelectedHookSize = (size: number) => setWorkspaces((current) => {
    const workspace=current.garment;
    return separateSceneWorkspaces({ ...current, garment:{ ...workspace, hookSizes:workspace.hookSizes.map((value,index)=>index===workspace.selectedIndex?size:value) } },groundEnabled);
  });
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
      const source = reader.result;
      const applyDecal = (height: number) => updateWorkspace(targetShape, (workspace) => {
          const nextDecals = { ...workspace.decals };
          targetSurfaces.forEach((surfaceId) => { nextDecals[faceMaterialKey(targetInstance, surfaceId)] = { src: source, name: file.name, u: .5, v: .5, width: .34, height, scale: 1 }; });
          return { ...workspace, decals: nextDecals };
        });
      const preview = new Image();
      preview.onload = () => applyDecal(Math.max(.05, Math.min(4, .34 * preview.naturalHeight / Math.max(1, preview.naturalWidth))));
      preview.onerror = () => applyDecal(.34);
      preview.src = source;
    };
    reader.readAsDataURL(file);
  };
  const changeSelectedDecal = (field: 'u' | 'v' | 'width' | 'height' | 'scale', value: number) => {
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
  const setOpeningSurface = (surfaceId: 'front' | 'back' | 'side') => updateWorkspace('garment', (workspace) => ({ ...workspace, openingSurfaceId:surfaceId }));
  const addOpening = () => updateWorkspace('garment', (workspace) => {
    const items = workspace.openings[workspace.selectedIndex] ?? [];
    if (items.length >= 12) return workspace;
    const slots = [[.5,.58],[.27,.58],[.73,.58],[.5,.38],[.27,.38],[.73,.38],[.5,.77],[.27,.77],[.73,.77],[.5,.24],[.27,.24],[.73,.24]];
    const available = slots.find(([u,v]) => !items.some((existing) => openingsOverlap(existing,{ id:'candidate', surfaceId:workspace.openingSurfaceId, shape:newOpeningShape, u, v, width:.18, height:.13, scale:1, rotation:0, cornerRadius:.34 }))) ?? slots[items.length%slots.length];
    const opening: GarmentOpening = {
      id:`opening-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      surfaceId:workspace.openingSurfaceId,
      shape:newOpeningShape,
      u:available[0], v:available[1], width:.18, height:.13, scale:1, rotation:0, cornerRadius:.34,
    };
    return { ...workspace, openings:workspace.openings.map((list,index) => index === workspace.selectedIndex ? [...list,opening] : list), selectedOpeningId:opening.id };
  });
  const selectOpening = (openingId: string, instanceIndex = selectedIndex) => updateWorkspace('garment', (workspace) => {
    const opening = workspace.openings[instanceIndex]?.find((item) => item.id === openingId);
    return { ...workspace, selectedIndex:instanceIndex, selectedOpeningId:openingId, openingSurfaceId:opening?.surfaceId ?? workspace.openingSurfaceId, selectedSurfaceIds:[] };
  });
  const changeSelectedOpening = (field: 'u' | 'v' | 'width' | 'height' | 'scale' | 'rotation' | 'cornerRadius', value: number) => updateWorkspace('garment', (workspace) => ({
    ...workspace,
    openings:workspace.openings.map((items,index) => index === workspace.selectedIndex ? items.map((opening) => {
      if (opening.id !== workspace.selectedOpeningId) return opening;
      const candidate = { ...opening, [field]:value };
      return items.some((other) => other.id !== opening.id && other.surfaceId === opening.surfaceId && openingsOverlap(candidate,other)) ? opening : candidate;
    }) : items),
  }));
  const chooseOpeningShape = (nextShape: OpeningShape) => {
    setNewOpeningShape(nextShape);
    if (!selectedOpeningId) return;
    updateWorkspace('garment', (workspace) => ({ ...workspace, openings:workspace.openings.map((items,index) => index === workspace.selectedIndex ? items.map((opening) => {
      if (opening.id !== workspace.selectedOpeningId) return opening;
      const candidate = { ...opening, shape:nextShape };
      return items.some((other) => other.id !== opening.id && other.surfaceId === opening.surfaceId && openingsOverlap(candidate,other)) ? opening : candidate;
    }) : items) }));
  };
  const removeSelectedOpening = () => updateWorkspace('garment', (workspace) => ({
    ...workspace,
    openings:workspace.openings.map((items,index) => index === workspace.selectedIndex ? items.filter((opening) => opening.id !== workspace.selectedOpeningId) : items),
    selectedOpeningId:null,
  }));
  const duplicateSelectedOpening = () => updateWorkspace('garment', (workspace) => {
    const items = workspace.openings[workspace.selectedIndex] ?? [];
    const source = items.find((opening) => opening.id === workspace.selectedOpeningId);
    if (!source || items.length >= 12) return workspace;
    const offsets = [[source.width*source.scale+.035,0],[-source.width*source.scale-.035,0],[0,source.height*source.scale+.035],[0,-source.height*source.scale-.035]];
    const position = offsets.map(([du,dv])=>[Math.max(.08,Math.min(.92,source.u+du)),Math.max(.08,Math.min(.92,source.v+dv))] as const).find(([u,v])=>!items.some((other)=>openingsOverlap({ ...source,u,v },other))) ?? [Math.min(.92,source.u+.08),Math.min(.92,source.v+.08)];
    const duplicate = { ...source, id:`opening-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, u:position[0], v:position[1] };
    return { ...workspace, openings:workspace.openings.map((list,index) => index === workspace.selectedIndex ? [...list,duplicate] : list), selectedOpeningId:duplicate.id };
  });
  const resetView = () => { setRotation({ yaw: -.62, pitch: -.38 }); setPan({ x:0, y:0 }); setZoom(1); };
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
          ? [x, Math.max(y, groundOffsetFor(animatedShape, dimensionsFor(workspace,index), nextAngle)), z] as Vec3
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
      link.download = `form3d-scene-${totalQuantity}x-${focalLength}mm-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setCaptureStatus(true);
      window.setTimeout(() => setCaptureStatus(false), 1500);
    }, "image/jpeg", .94);
  };
  const beginCanvasPointer = (event:ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas=event.currentTarget;
    const rect=canvas.getBoundingClientRect();
    const point={x:event.clientX-rect.left,y:event.clientY-rect.top};
    if (event.button===1) {
      canvas.setPointerCapture(event.pointerId);
      pointerRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'pan',objectShape:shape,objectIndex:-1};
      canvas.classList.add('is-panning');
      return;
    }
    if (event.button===2 || (event.button===0 && event.altKey)) {
      canvas.setPointerCapture(event.pointerId);
      pointerRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'camera',objectShape:shape,objectIndex:-1};
      canvas.classList.add('is-dragging');
      return;
    }
    if (event.button!==0) return;
    const gizmoHit=[...gizmoHitRegionsRef.current].sort((a,b)=>distanceToSegment(point,a.start,a.end)-distanceToSegment(point,b.start,b.end)).find((region)=>distanceToSegment(point,region.start,region.end)<=12);
    if (gizmoHit) {
      canvas.setPointerCapture(event.pointerId);
      pointerRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'gizmo',objectShape:gizmoHit.shape,objectIndex:gizmoHit.index,axis:gizmoHit.axis,axisScreen:gizmoHit.direction};
      canvas.classList.add('is-gizmo-dragging');
      return;
    }
    if (openingPickerEnabled) {
      const openingHit=[...openingRegionsRef.current].reverse().find((region)=>region.shape==='garment'&&pointInPolygon(point.x,point.y,region.polygon));
      if (openingHit) { setShape('garment');selectOpening(openingHit.openingId,openingHit.instanceIndex);return; }
      const targetFace=[...faceRegionsRef.current].reverse().find((region)=>region.shape==='garment'&&(region.surfaceId==='front'||region.surfaceId==='back'||region.surfaceId==='side')&&pointInPolygon(point.x,point.y,region.polygon)&&!region.holes?.some((hole)=>pointInPolygon(point.x,point.y,hole)));
      if (targetFace) { setShape('garment');updateWorkspace('garment',(workspace)=>({...workspace,selectedIndex:targetFace.instanceIndex,openingSurfaceId:targetFace.surfaceId as 'front'|'back'|'side',selectedOpeningId:null,selectedSurfaceIds:[]}));return; }
    }
    const faceHit=[...faceRegionsRef.current].reverse().find((region)=>pointInPolygon(point.x,point.y,region.polygon)&&!region.holes?.some((hole)=>pointInPolygon(point.x,point.y,hole)));
    if (faceHit && materialPickerEnabled) {
      const append=event.shiftKey;
      setShape(faceHit.shape);
      updateWorkspace(faceHit.shape,(workspace)=>({...workspace,selectedIndex:faceHit.instanceIndex,selectedSurfaceIds:updateSurfaceSelection(workspace.selectedIndex===faceHit.instanceIndex?workspace.selectedSurfaceIds:[],faceHit.surfaceId,append)}));
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    if (faceHit) {
      selectInstance(faceHit.shape,faceHit.instanceIndex);
      setGizmoVisible(true);
      pointerRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'object',objectShape:faceHit.shape,objectIndex:faceHit.instanceIndex};
      canvas.classList.add('is-moving-object');
      return;
    }
    setGizmoVisible(false);
    pointerRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'camera',objectShape:shape,objectIndex:-1};
    canvas.classList.add('is-dragging');
  };
  const moveCanvasPointer = (event:ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer=pointerRef.current;
    if (!pointer||pointer.id!==event.pointerId) return;
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    if (pointer.action==='camera') setRotation((current)=>({yaw:current.yaw+dx*.009,pitch:Math.max(-1.48,Math.min(1.48,current.pitch+dy*.009))}));
    else if (pointer.action==='pan') setPan((current)=>({x:current.x+dx,y:current.y+dy}));
    else {
      const canvas=event.currentTarget;
      const factor=2.45/(Math.max(220,Math.min(canvas.clientWidth,canvas.clientHeight))*zoom);
      if (pointer.action==='gizmo' && pointer.axis && pointer.axisScreen) {
        const amount=(dx*pointer.axisScreen.x+dy*pointer.axisScreen.y)*factor;
        const delta:Vec3=pointer.axis==='x'?[amount,0,0]:pointer.axis==='y'?[0,amount,0]:[0,0,amount];
        moveInstanceByDelta(pointer.objectShape,pointer.objectIndex,delta);
      } else {
        const delta=inverseRotate([dx*factor,-dy*factor,0],rotation.yaw,rotation.pitch);
        moveInstanceByDelta(pointer.objectShape,pointer.objectIndex,delta);
      }
    }
    pointerRef.current={...pointer,x:event.clientX,y:event.clientY};
  };
  const endCanvasPointer = (event:ReactPointerEvent<HTMLCanvasElement>) => {
    pointerRef.current=null;
    event.currentTarget.classList.remove('is-dragging','is-moving-object','is-panning','is-gizmo-dragging');
  };
  const fieldOfView = Math.round((2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI);
  return <main className="studio-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Box size={19} strokeWidth={2.2} /></span><div><strong>FORM<span>3D</span></strong><small>形体工作台</small></div></div><div className="topbar-status"><span className="status-dot" />实时预览</div></header>
    <div className="workspace">
      <aside className="shape-panel" aria-label="图形选择"><div className="panel-title"><span>01</span><div><strong>添加图形</strong><small>点击加入同一画布</small></div></div><div className="shape-list">
        {SHAPES.map((item) => { const Icon = item.icon; const count=workspaces[item.id].positions.length; return <Button key={item.id} variant="ghost" className={`shape-button ${shape === item.id && count ? "is-active" : ""}`} onClick={() => addShapeInstance(item.id)} aria-label={`添加${item.label}`}><span className="shape-icon"><Icon size={25} strokeWidth={1.55} /></span><span>{item.label}<small>点击添加</small></span><i>{count || <Plus size={12}/>}</i></Button>; })}
      </div><div className="interaction-tip"><MousePointer2 size={18} /><p><strong>点击模型后拖动 XYZ 移动</strong><span>空白左键或右键旋转 · 中键平移 · 滚轮缩放</span></p></div></aside>
      <section className="viewport-panel" aria-label="3D 预览区">
        <div className="viewport-meta"><div><span className="eyebrow">{threeViewEnabled?'FOUR VIEW WORKSPACE':`PERSPECTIVE / ${focalLength}mm`}</span><strong>{totalQuantity ? `混合场景 × ${totalQuantity}` : '空白工作画布'}</strong></div><div className="view-actions"><Button className="capture-button" size="sm" onClick={saveJpg}><Download size={15}/>{captureStatus ? "已保存" : "拍照 JPG"}</Button><Button className="three-view-button" variant={threeViewEnabled?'default':'ghost'} size="sm" onClick={()=>setThreeViewEnabled((enabled)=>!enabled)} aria-pressed={threeViewEnabled}><Grid3X3 size={15}/>{threeViewEnabled?'退出三视图':'展开三视图'}</Button><Button variant="ghost" size="sm" onClick={toggleGround} aria-pressed={groundEnabled}>{groundEnabled ? <Minus size={15}/> : <Plus size={15}/>} {groundEnabled ? "移除地面" : "添加地面"}</Button><Button variant="ghost" size="sm" onClick={() => setGridVisible((visible) => !visible)} aria-pressed={gridVisible}><Grid3X3 size={16} />网格</Button><Button variant="ghost" size="sm" onClick={resetView}><Redo2 size={15} />复位</Button></div></div>
        <div className={`viewport-workarea ${threeViewEnabled?'is-quad':'is-single'}`}>
        <div className={`canvas-stage ${captureStatus ? "is-captured" : ""}`}><canvas ref={canvasRef} tabIndex={0} aria-label="1比1透视画布，点击模型选择，拖动XYZ坐标轴移动，右键或Alt加左键旋转，中键平移，滚轮缩放"
          onPointerDown={beginCanvasPointer}
          onPointerMove={moveCanvasPointer}
          onPointerUp={endCanvasPointer} onPointerCancel={endCanvasPointer} onAuxClick={(event)=>event.preventDefault()} onContextMenu={(event)=>event.preventDefault()} onDoubleClick={resetView}
          onWheel={(e) => { e.preventDefault(); const canvas=e.currentTarget; const bounds=selectedProjectionBounds(workspaces,shape,rotation,focalLength,canvas.clientWidth,canvas.clientHeight); setZoom((current)=>{ const minimum=Math.min(MIN_ZOOM,zoomLimit*.5); const next=Math.max(minimum,Math.min(zoomLimit,current-e.deltaY*.0015)); const anchorX=bounds?(bounds.minX+bounds.maxX)/2:0; const anchorY=bounds?(bounds.minY+bounds.maxY)/2:0; setPan((position)=>clampPanToSquare({x:position.x+anchorX*(current-next),y:position.y+anchorY*(current-next)},bounds,next,canvas.clientWidth,canvas.clientHeight)); return next; }); }}
          onKeyDown={(e) => { if(e.key==="ArrowLeft")setRotation((r)=>({...r,yaw:r.yaw-.08})); if(e.key==="ArrowRight")setRotation((r)=>({...r,yaw:r.yaw+.08})); if(e.key==="ArrowUp")setRotation((r)=>({...r,pitch:Math.max(-1.48,r.pitch-.08)})); if(e.key==="ArrowDown")setRotation((r)=>({...r,pitch:Math.min(1.48,r.pitch+.08)})); if(e.key==="0")resetView(); }} />
          {threeViewEnabled?<div className="ortho-title perspective-title"><span>PERSPECTIVE</span><strong>透视视图</strong></div>:<div className="canvas-ratio-label">1:1 极限画布</div>}{!totalQuantity && <div className="empty-canvas-state"><span><Plus size={22}/></span><strong>空白工作画布</strong><small>点击左侧任意图形，将模型添加到这里</small></div>}{hasSelectedModel && <><div className="dimension-badge badge-width"><span>W</span>{dimensionLabel(dimensions.width)}</div><div className="dimension-badge badge-height"><span>H</span>{dimensionLabel(dimensions.height)}</div><div className="dimension-badge badge-depth"><span>D</span>{dimensionLabel(dimensions.depth)}</div></>}<div className="camera-readout"><Camera size={14}/><span>{focalLength}mm · {fieldOfView}°</span></div><div className="zoom-readout"><Rotate3D size={15} /><span>{Math.round(zoom*100)}% / 极限 {Math.round(zoomLimit*100)}%</span></div><div className="capture-confirmation"><Camera size={16}/>JPG 已保存</div>
          {groundEnabled && <div className="ground-status"><span className="status-dot"/>固定地面 · 防穿透</div>}
        </div>
        {threeViewEnabled&&(['front','top','right'] as OrthographicView[]).map((view)=><OrthographicViewport key={view} view={view} selectedShape={shape} workspaces={workspaces} gridVisible={gridVisible} groundEnabled={groundEnabled} onSelect={selectInstance} onMove={moveInstanceByDelta}/>) }
        </div>
        {!threeViewEnabled&&<div className="view-presets" aria-label="视角预设"><span>快速视角</span><Button variant="outline" size="sm" onClick={()=>setView("front")}>正面</Button><Button variant="outline" size="sm" onClick={()=>setView("top")}>顶面</Button><Button variant="outline" size="sm" onClick={()=>setView("iso")}>等轴</Button></div>}
      </section>
      <aside className="control-panel" aria-label="模型与摄像机控制"><div className="panel-title"><span>02</span><div><strong>{hasSelectedModel?'调整模型':'等待添加'}</strong><small>{hasSelectedModel?'编辑当前选中模型':'画布当前为空'}</small></div></div>{!hasSelectedModel?<div className="empty-control-state"><span><Plus size={20}/></span><strong>还没有可编辑的模型</strong><p>从左侧选择长方体、圆柱体或西服套，即可添加到同一个工作画布。</p></div>:<><div className="controls">
        {isGarment ? <><DimensionControl label="宽度" axis="W" value={Math.round(dimensions.width * 100)} unit="%" onChange={(v)=>changeDimension("width",v / 100)} /><DimensionControl label="底部高度" axis="H" value={Math.round(dimensions.height * 100)} unit="%" minValue={50} onChange={(v)=>changeDimension("height",v / 100)} /><DimensionControl label="厚度" axis="D" value={Math.round(dimensions.depth * 100)} unit="%" onChange={(v)=>changeDimension("depth",v / 100)} /></> : <><DimensionControl label="长度" axis="W" value={dimensions.width} unit="cm" onChange={(v)=>changeDimension("width",v)} /><DimensionControl label="高度" axis="H" value={dimensions.height} unit="cm" onChange={(v)=>changeDimension("height",v)} /><DimensionControl label="深度" axis="D" value={dimensions.depth} unit="cm" onChange={(v)=>changeDimension("depth",v)} /></>}
        <div className="scale-control"><div className="control-heading"><span><Maximize2 size={16}/>当前模型等比缩放</span><output>{dimensions.scale.toFixed(1)}×</output></div><Slider aria-label="当前模型等比缩放" min={.5} max={2} step={.1} value={[dimensions.scale]} onValueChange={([next])=>changeDimension("scale",next)} /><div className="slider-ends"><span>0.5× 缩小</span><span>2.0× 放大</span></div></div>
      </div><div className="size-summary"><span>{isGarment ? "宽 × 底部高度 × 厚 · 当前模型" : "当前选中模型尺寸"}</span><strong>{dimensionLabel(dimensions.width)} × {dimensionLabel(dimensions.height)} × {dimensionLabel(dimensions.depth)}</strong><small>{isGarment ? `形体 ${selectedIndex+1} · 高度只改变底边 · 等比 ${dimensions.scale.toFixed(1)}×` : `形体 ${selectedIndex+1} · 单位：厘米 · 等比 ${dimensions.scale.toFixed(1)}×`}</small>{isGarment && <Button variant="secondary" size="sm" onClick={resetSelectedGarmentDimensions}>恢复当前模型比例</Button>}</div>
        <section className="editor-section instance-section" aria-label="数量与自由摆放">
          <div className="section-heading"><span><Copy size={16}/>数量与自由摆放</span><output>{quantity} 个</output></div>
          <div className="quantity-stepper"><Button variant="outline" size="icon" aria-label="减少数量" disabled={quantity<=1} onClick={()=>changeQuantity(quantity-1)}><Minus size={14}/></Button><strong>{quantity}</strong><Button variant="outline" size="icon" aria-label="增加数量" disabled={quantity>=12} onClick={()=>changeQuantity(quantity+1)}><Plus size={14}/></Button></div>
          <Slider aria-label="几何图形数量" min={1} max={12} step={1} value={[quantity]} onValueChange={([next])=>changeQuantity(next)} />
          <p className="free-layout-tip"><Move3D size={14}/>新增时复制当前形体的材质、投射和组件状态，并自动接触摆放。</p>
          <div className="instance-picker" aria-label="选择要编辑的形体">{positions.map((_,index)=><Button key={index} size="sm" variant={selectedIndex===index?"default":"outline"} onClick={()=>selectInstance(shape,index)} aria-pressed={selectedIndex===index}>{index+1}</Button>)}</div>
          <Button className="remove-model-button" variant="outline" size="sm" onClick={removeSelectedModel}><Trash2 size={14}/>删除当前{SHAPES.find((item)=>item.id===shape)?.label}</Button>
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
          <Button className="material-mode-button" variant={materialPickerEnabled?"default":"outline"} aria-pressed={materialPickerEnabled} onClick={()=>{setMaterialPickerEnabled((enabled)=>!enabled);setOpeningPickerEnabled(false);}}><MousePointer2 size={15}/>{materialPickerEnabled?"正在选面 · 点击表面":"启用选面"}</Button>
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
                {([['u','水平位置',0,100],['v','垂直位置',0,100],['width','贴花宽度',5,400],['height','贴花高度',5,400],['scale','等比缩放',10,400]] as const).map(([field,label,min,max])=>{ const current=Math.round(selectedDecal[field]*100); return <div className={`decal-control-row ${field==='scale'?'decal-scale-row':''}`} key={field}><div className="control-heading"><span>{field==='scale'?<><Maximize2 size={14}/>{label}</>:label}</span><label className="value-field texture-value-field"><input aria-label={`${label}百分比`} type="number" min={min} max={max} step={1} value={current} onChange={(event)=>changeSelectedDecal(field,decalPercent(Number(event.target.value),min,max))}/><span>%</span></label></div><Slider aria-label={`${label}`} min={min} max={max} step={1} value={[current]} onValueChange={([next])=>changeSelectedDecal(field,next/100)}/>{field==='scale'&&<div className="slider-ends"><span>10%</span><span>保持当前长宽比例</span><span>400%</span></div>}</div>; })}
              </div>
            </>}
          </>}
          <div className="projection-note"><Grid3X3 size={14}/><span>{selectedProjection==='cube'?"立方体投射依据 X / Y / Z 方向保持纹理尺寸。":"UVW 按模型坐标展开，圆柱侧面会连续环绕。"} PNG 贴花独立叠加并保留透明区域。</span></div>
        </section>
        {isGarment && <section className="editor-section opening-section" aria-label="西服套真实几何开口">
          <div className="section-heading"><span><Scissors size={16}/>形体 {selectedIndex+1} 几何开口</span><output>{currentOpenings.length} / 12</output></div>
          <p>在正面或背面建立真实开口，可透视内部空间；开口边缘会自动生成厚度。</p>
          <Button className="opening-mode-button" variant={openingPickerEnabled?"default":"outline"} aria-pressed={openingPickerEnabled} onClick={()=>{setOpeningPickerEnabled((enabled)=>!enabled);setMaterialPickerEnabled(false);}}><MousePointer2 size={15}/>{openingPickerEnabled?'正在选择开口面':'在画布中选择开口面'}</Button>
          <div className="opening-surface-switch"><span>目标表面</span><div><Button size="sm" variant={openingSurfaceId==='front'?"default":"outline"} onClick={()=>setOpeningSurface('front')}>正面</Button><Button size="sm" variant={openingSurfaceId==='back'?"default":"outline"} onClick={()=>setOpeningSurface('back')}>背面</Button><Button size="sm" variant={openingSurfaceId==='side'?"default":"outline"} onClick={()=>setOpeningSurface('side')}>侧围</Button></div></div>
          <div className="opening-shape-grid" aria-label="选择开口形状">
            {(['rectangle','rounded-rectangle','circle','ellipse'] as OpeningShape[]).map((openingShape)=><Button key={openingShape} size="sm" variant={(selectedOpening?.shape ?? newOpeningShape)===openingShape?'default':'outline'} onClick={()=>chooseOpeningShape(openingShape)}>{openingShapeLabel(openingShape)}</Button>)}
          </div>
          <Button className="add-opening-button" disabled={currentOpenings.length>=12} onClick={addOpening}><Plus size={15}/>{currentOpenings.length>=12?'已达到 12 个开口':'新增开口'}</Button>
          {!!currentOpenings.length && <div className="opening-picker" aria-label="选择要编辑的开口">{currentOpenings.map((opening,index)=><Button key={opening.id} size="sm" variant={selectedOpeningId===opening.id?'default':'outline'} onClick={()=>selectOpening(opening.id)}><span>{index+1}</span>{openingShapeLabel(opening.shape)} · {opening.surfaceId==='front'?'正面':opening.surfaceId==='back'?'背面':'侧围'}</Button>)}</div>}
          {selectedOpening && <div className="opening-controls">
              <div className="opening-selected-status"><span className="status-dot"/><div><strong>开口 {currentOpenings.findIndex((opening)=>opening.id===selectedOpening.id)+1} · {openingShapeLabel(selectedOpening.shape)}</strong><small>{selectedOpening.surfaceId==='front'?'正面':selectedOpening.surfaceId==='back'?'背面':'侧围'} · 独立几何裁切</small></div></div>
            {([['u',selectedOpening.surfaceId==='side'?'侧围环绕位置':'水平位置',8,92],['v',selectedOpening.surfaceId==='side'?'前后位置':'垂直位置',8,92],['width',selectedOpening.shape==='circle'?'直径':selectedOpening.surfaceId==='side'?'开口长度':'开口宽度',5,70],...(selectedOpening.shape==='circle'?[]:[['height',selectedOpening.surfaceId==='side'?'厚向宽度':'开口高度',5,70] as const]),['scale','等比缩放',25,250]] as const).map(([field,label,min,max])=>{const current=Math.round(selectedOpening[field]*100);return <div className="opening-control-row" key={field}><div className="control-heading"><span>{label}</span><label className="value-field texture-value-field"><input type="number" aria-label={`${label}百分比`} min={min} max={max} value={current} onChange={(event)=>changeSelectedOpening(field,decalPercent(Number(event.target.value),min,max))}/><span>%</span></label></div><Slider aria-label={label} min={min} max={max} step={1} value={[current]} onValueChange={([next])=>changeSelectedOpening(field,next/100)}/></div>;})}
            <div className="opening-control-row"><div className="control-heading"><span>旋转角度</span><label className="value-field texture-value-field"><input type="number" aria-label="开口旋转角度" min={-180} max={180} value={Math.round(selectedOpening.rotation)} onChange={(event)=>changeSelectedOpening('rotation',Math.max(-180,Math.min(180,Number(event.target.value)||0)))}/><span>°</span></label></div><Slider aria-label="开口旋转角度" min={-180} max={180} step={1} value={[selectedOpening.rotation]} onValueChange={([next])=>changeSelectedOpening('rotation',next)}/></div>
            {selectedOpening.shape==='rounded-rectangle'&&<div className="opening-control-row"><div className="control-heading"><span>圆角大小</span><label className="value-field texture-value-field"><input type="number" aria-label="开口圆角大小" min={0} max={100} value={Math.round(selectedOpening.cornerRadius*100)} onChange={(event)=>changeSelectedOpening('cornerRadius',decalPercent(Number(event.target.value)))}/><span>%</span></label></div><Slider aria-label="开口圆角大小" min={0} max={100} step={1} value={[selectedOpening.cornerRadius*100]} onValueChange={([next])=>changeSelectedOpening('cornerRadius',next/100)}/></div>}
            <div className="opening-actions"><Button variant="outline" size="sm" disabled={currentOpenings.length>=12} onClick={duplicateSelectedOpening}><Copy size={14}/>复制</Button><Button variant="outline" size="sm" onClick={removeSelectedOpening}><Trash2 size={14}/>删除</Button></div>
          </div>}
          <div className="opening-note"><span>内部空间</span><p>开口会裁掉外层面板，并生成深色切口内壁和对侧内层；多个开口保持独立且不会相互穿叠，材质、贴花与 JPG 会同步反映开口。</p></div>
        </section>}
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
          <p>只控制当前选中的形体；{shape === "box" ? "沿长方体后边缘铰链翻动" : shape === "trapezoid" ? "后部平盖沿最后方铰链翻动，前斜面保持固定" : "沿圆柱体后侧铰链翻动"}。</p>
          <Slider aria-label={`形体 ${selectedIndex+1} 盖面开启角度`} min={0} max={200} step={1} value={[selectedLidAngle]} onValueChange={([next])=>changeSelectedLid(next)} />
          <div className="lid-angle-range"><span>0° 关闭</span><span>200° 翻至背后</span></div>
          <div className="lid-presets"><Button variant="outline" size="sm" onClick={()=>animateLid(0)}>关闭</Button><Button variant="outline" size="sm" onClick={()=>animateLid(60)}>半开</Button><Button variant="outline" size="sm" onClick={()=>animateLid(110)}>打开</Button><Button size="sm" onClick={()=>animateLid(180)}>翻至背面</Button></div>
        </section>}
        </>}
      </aside>
    </div>
  </main>;
}
