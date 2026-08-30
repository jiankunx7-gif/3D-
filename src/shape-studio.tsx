"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Camera, Copy, Cylinder, DoorOpen, Download, Grid3X3, LocateFixed, Maximize2, Minus, MousePointer2, Move3D, Plus, Redo2, Rotate3D } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type ShapeType = "box" | "cylinder";
type Dimensions = { width: number; height: number; depth: number; scale: number };
type Vec3 = [number, number, number];
type ShapeWorkspace = { dimensions: Dimensions; positions: Vec3[]; lidAngles: number[]; selectedIndex: number };
type Mesh = { vertices: Vec3[]; faces: number[][] };
type SceneFace = { points: Vec3[]; material: "body" | "lid" | "inside" };
type InstanceFace = SceneFace & { instanceIndex: number };
type HitRegion = { index: number; x: number; y: number; radius: number };
const GROUND_Y = -0.64;
const MIN_ZOOM = 0.62;
const MAX_ZOOM_SEARCH = 6;
const CANVAS_EDGE_PADDING = 12;

const SHAPES = [
  { id: "box" as const, label: "长方体", icon: Box },
  { id: "cylinder" as const, label: "圆柱体", icon: Cylinder },
];

function boxMesh(): Mesh {
  return {
    vertices: [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ],
    faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]],
  };
}

function cylinderMesh(): Mesh {
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  const segments = 28;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    vertices.push([Math.cos(angle) * 0.5, -0.5, Math.sin(angle) * 0.5]);
  }
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    vertices.push([Math.cos(angle) * 0.5, 0.5, Math.sin(angle) * 0.5]);
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    faces.push([i, next, segments + next, segments + i]);
  }
  faces.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));
  faces.push(Array.from({ length: segments }, (_, i) => segments + i));
  return { vertices, faces };
}

function meshFor(shape: ShapeType) { return shape === "box" ? boxMesh() : cylinderMesh(); }

function hingeRotate([x, y, z]: Vec3, hingeY: number, hingeZ: number, angle: number): Vec3 {
  const dy = y - hingeY, dz = z - hingeZ;
  const c = Math.cos(-angle), s = Math.sin(-angle);
  return [x, hingeY + dy * c - dz * s, hingeZ + dy * s + dz * c];
}

function sceneFaces(shape: ShapeType, dimensions: Dimensions, lidAngle: number): SceneFace[] {
  const width = dimensions.width * dimensions.scale;
  const height = dimensions.height * dimensions.scale;
  const depth = dimensions.depth * dimensions.scale;
  const mesh = meshFor(shape);
  const topFaceIndex = shape === "box" ? 4 : mesh.faces.length - 1;
  const faces: SceneFace[] = mesh.faces
    .filter((_, index) => index !== topFaceIndex)
    .map((face) => ({
      material: "body" as const,
      points: face.map((index) => {
        const [x, y, z] = mesh.vertices[index];
        return [x * width, y * height, z * depth] as Vec3;
      }),
    }));

  const insideY = height / 2 - Math.max(0.018, height * 0.012);
  const thickness = Math.max(0.055, Math.min(width, depth) * 0.035);
  const angle = (lidAngle * Math.PI) / 180;
  const hingeY = height / 2;
  const hingeZ = -depth / 2;

  if (shape === "box") {
    faces.push({
      material: "inside",
      points: [[-width/2, insideY, -depth/2], [-width/2, insideY, depth/2], [width/2, insideY, depth/2], [width/2, insideY, -depth/2]],
    });
    const lidVertices: Vec3[] = [
      [-width/2, hingeY, -depth/2], [width/2, hingeY, -depth/2], [width/2, hingeY, depth/2], [-width/2, hingeY, depth/2],
      [-width/2, hingeY + thickness, -depth/2], [width/2, hingeY + thickness, -depth/2], [width/2, hingeY + thickness, depth/2], [-width/2, hingeY + thickness, depth/2],
    ].map((point) => hingeRotate(point, hingeY, hingeZ, angle));
    [[0,3,2,1], [4,5,6,7], [0,1,5,4], [3,7,6,2], [0,4,7,3], [1,2,6,5]].forEach((face) => {
      faces.push({ material: "lid", points: face.map((index) => lidVertices[index]) });
    });
  } else {
    const segments = 28;
    const inside = Array.from({ length: segments }, (_, i) => {
      const theta = (i / segments) * Math.PI * 2;
      return [Math.cos(theta) * width/2, insideY, Math.sin(theta) * depth/2] as Vec3;
    });
    faces.push({ material: "inside", points: inside });
    const lower = inside.map(([x,,z]) => hingeRotate([x, hingeY, z], hingeY, hingeZ, angle));
    const upper = inside.map(([x,,z]) => hingeRotate([x, hingeY + thickness, z], hingeY, hingeZ, angle));
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push({ material: "lid", points: [lower[i], lower[next], upper[next], upper[i]] });
    }
    faces.push({ material: "lid", points: [...lower].reverse() });
    faces.push({ material: "lid", points: upper });
  }
  return faces;
}

function positionedSceneFaces(shape: ShapeType, dimensions: Dimensions, lidAngles: number[], positions: Vec3[]): InstanceFace[] {
  const fit = Math.max(dimensions.width * dimensions.scale, dimensions.height * dimensions.scale, dimensions.depth * dimensions.scale, .1);
  return positions.flatMap(([offsetX, offsetY, offsetZ], instanceIndex) =>
    sceneFaces(shape, dimensions, lidAngles[instanceIndex] ?? 0).map(({ points, material }) => ({
      material,
      instanceIndex,
      points: points.map(([x,y,z]) => [x / fit + offsetX, y / fit + offsetY, z / fit + offsetZ] as Vec3),
    }))
  );
}

function groundOffsetFor(shape: ShapeType, dimensions: Dimensions, lidAngle: number) {
  const fit = Math.max(dimensions.width * dimensions.scale, dimensions.height * dimensions.scale, dimensions.depth * dimensions.scale, .1);
  const lowestPoint = Math.min(...sceneFaces(shape, dimensions, lidAngle).flatMap((face) => face.points.map((point) => point[1]))) / fit;
  return GROUND_Y - lowestPoint;
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

function calculateZoomLimit(shape: ShapeType, dimensions: Dimensions, rotation: { yaw: number; pitch: number }, focalLength: number, lidAngles: number[], positions: Vec3[], width: number, height: number) {
  if (width <= 0 || height <= 0) return 1.72;
  const points = positionedSceneFaces(shape, dimensions, lidAngles, positions)
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
  if (!fits(MIN_ZOOM)) return MIN_ZOOM;
  let low = MIN_ZOOM;
  let high = MAX_ZOOM_SEARCH;
  for (let index = 0; index < 26; index++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM_SEARCH, low));
}

function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>, hitRegionsRef: React.MutableRefObject<HitRegion[]>, drawSceneRef: React.MutableRefObject<((cleanCapture?: boolean) => void) | null>, shape: ShapeType, dimensions: Dimensions, rotation: { yaw: number; pitch: number }, zoom: number, gridVisible: boolean, groundEnabled: boolean, focalLength: number, lidAngles: number[], positions: Vec3[], selectedIndex: number) {
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
      const scene = positionedSceneFaces(shape, dimensions, lidAngles, positions);
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
      const visibleFaces = scene.map(({ points, material, instanceIndex }) => {
        const transformed = points.map((point) => rotate(point, rotation.yaw, rotation.pitch));
        const projected = transformed.map(project);
        instanceProjected[instanceIndex].push(...projected);
        const p0 = transformed[0], p1 = transformed[1], p2 = transformed[2];
        const u: Vec3 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        const v: Vec3 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        const normal: Vec3 = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const length = Math.hypot(...normal) || 1;
        const shade = Math.max(0, (normal[0]*light[0] + normal[1]*light[1] + normal[2]*light[2]) / length);
        return { projected, depth: transformed.reduce((sum, point) => sum + point[2], 0) / transformed.length, shade, material, instanceIndex };
      }).sort((a, b) => a.depth - b.depth);
      ctx.lineJoin = "round";
      for (const { projected, shade, material } of visibleFaces) {
        ctx.beginPath();
        projected.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        ctx.fillStyle = material === "inside" ? "hsl(216 20% 20%)" : material === "lid" ? `hsl(20 92% ${49 + shade * 24}%)` : `hsl(18 88% ${42 + shade * 24}%)`;
        ctx.fill();
        ctx.strokeStyle = material === "inside" ? "rgba(255,255,255,.08)" : material === "lid" ? "rgba(90,34,12,.38)" : "rgba(68,28,12,.22)";
        ctx.lineWidth = material === "lid" ? 1 : .75;
        ctx.stroke();
      }
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
  }, [canvasRef, hitRegionsRef, drawSceneRef, shape, dimensions, rotation, zoom, gridVisible, groundEnabled, focalLength, lidAngles, positions, selectedIndex]);
}

function DimensionControl({ label, axis, value, unit, onChange }: { label: string; axis: string; value: number; unit: string; onChange: (value: number) => void }) {
  return <div className="dimension-control">
    <div className="control-heading"><span><b className={`axis axis-${axis.toLowerCase()}`}>{axis}</b>{label}</span><label className="value-field"><input aria-label={`${label}数值`} type="number" min="0.5" max="10" step="0.1" value={value} onChange={(e) => onChange(Math.min(10, Math.max(.5, Number(e.target.value) || .5)))} /><span>{unit}</span></label></div>
    <Slider aria-label={label} min={0.5} max={10} step={0.1} value={[value]} onValueChange={([next]) => onChange(next)} />
  </div>;
}

export default function ShapeStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const drawSceneRef = useRef<((cleanCapture?: boolean) => void) | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; action: "object" | "camera"; objectIndex: number } | null>(null);
  const lidAnimationRef = useRef<number | null>(null);
  const [shape, setShape] = useState<ShapeType>("box");
  const [workspaces, setWorkspaces] = useState<Record<ShapeType, ShapeWorkspace>>({
    box: { dimensions: { width: 4, height: 3, depth: 2.5, scale: 1 }, positions: [[0, 0, 0]], lidAngles: [0], selectedIndex: 0 },
    cylinder: { dimensions: { width: 3, height: 4, depth: 3, scale: 1 }, positions: [[0, 0, 0]], lidAngles: [0], selectedIndex: 0 },
  });
  const [rotation, setRotation] = useState({ yaw: -.62, pitch: -.38 });
  const [zoom, setZoom] = useState(1);
  const [zoomLimit, setZoomLimit] = useState(1.72);
  const [gridVisible, setGridVisible] = useState(true);
  const [groundEnabled, setGroundEnabled] = useState(false);
  const [focalLength, setFocalLength] = useState(35);
  const [captureStatus, setCaptureStatus] = useState(false);
  const { dimensions, positions, lidAngles, selectedIndex } = workspaces[shape];
  const quantity = positions.length;
  const selectedLidAngle = lidAngles[selectedIndex] ?? 0;
  const groundMinY = groundOffsetFor(shape, dimensions, selectedLidAngle);
  useCanvasRenderer(canvasRef, hitRegionsRef, drawSceneRef, shape, dimensions, rotation, zoom, gridVisible, groundEnabled, focalLength, lidAngles, positions, selectedIndex);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateLimit = () => {
      const nextLimit = calculateZoomLimit(shape, dimensions, rotation, focalLength, lidAngles, positions, canvas.clientWidth, canvas.clientHeight);
      setZoomLimit(nextLimit);
      setZoom((current) => Math.min(current, nextLimit));
    };
    updateLimit();
    const observer = new ResizeObserver(updateLimit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [shape, dimensions, rotation, focalLength, lidAngles, positions]);
  const updateWorkspace = useCallback((targetShape: ShapeType, updater: (workspace: ShapeWorkspace) => ShapeWorkspace) => {
    setWorkspaces((current) => ({ ...current, [targetShape]: updater(current[targetShape]) }));
  }, []);
  const changeDimension = useCallback((key: keyof Dimensions, value: number) => updateWorkspace(shape, (workspace) => {
    const nextDimensions = { ...workspace.dimensions, [key]: value };
    if (!groundEnabled) return { ...workspace, dimensions: nextDimensions };
    return { ...workspace, dimensions: nextDimensions, positions: workspace.positions.map(([x,y,z], index) => {
      const oldGroundY = groundOffsetFor(shape, workspace.dimensions, workspace.lidAngles[index] ?? 0);
      const nextGroundY = groundOffsetFor(shape, nextDimensions, workspace.lidAngles[index] ?? 0);
      return [x, Math.abs(y-oldGroundY)<.02 ? nextGroundY : Math.max(y,nextGroundY), z] as Vec3;
    }) };
  }), [shape, groundEnabled, updateWorkspace]);
  const selectInstance = (index: number) => updateWorkspace(shape, (workspace) => ({ ...workspace, selectedIndex: index }));
  const toggleGround = () => {
    if (groundEnabled) { setGroundEnabled(false); return; }
    setWorkspaces((current) => ({
      box: { ...current.box, positions: current.box.positions.map(([x,,z], index) => [x, groundOffsetFor("box", current.box.dimensions, current.box.lidAngles[index] ?? 0), z] as Vec3) },
      cylinder: { ...current.cylinder, positions: current.cylinder.positions.map(([x,,z], index) => [x, groundOffsetFor("cylinder", current.cylinder.dimensions, current.cylinder.lidAngles[index] ?? 0), z] as Vec3) },
    }));
    setGroundEnabled(true);
  };
  const changeQuantity = (nextQuantity: number) => {
    const next = Math.max(1, Math.min(12, Math.round(nextQuantity)));
    updateWorkspace(shape, (workspace) => {
      const nextPositions = next <= workspace.positions.length ? workspace.positions.slice(0, next) : [...workspace.positions, ...Array.from({ length: next - workspace.positions.length }, (_, offset) => {
        const index = workspace.positions.length + offset;
        return [((index % 3) - 1) * .14, groundEnabled ? groundOffsetFor(shape, workspace.dimensions, 0) : Math.floor(index / 3) * .1, 0] as Vec3;
      })];
      const nextLidAngles = next <= workspace.lidAngles.length ? workspace.lidAngles.slice(0, next) : [...workspace.lidAngles, ...Array(next - workspace.lidAngles.length).fill(0)];
      return { ...workspace, positions: nextPositions, lidAngles: nextLidAngles, selectedIndex: Math.min(next - 1, workspace.selectedIndex) };
    });
  };
  const changePosition = (axis: 0 | 1 | 2, value: number) => {
    updateWorkspace(shape, (workspace) => ({ ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? position.map((item, itemIndex) => itemIndex === axis ? (axis === 1 && groundEnabled ? Math.max(value,groundOffsetFor(shape,workspace.dimensions,workspace.lidAngles[index] ?? 0)) : value) : item) as Vec3 : position) }));
  };
  const resetSelectedPosition = () => updateWorkspace(shape, (workspace) => ({ ...workspace, positions: workspace.positions.map((position, index) => index === workspace.selectedIndex ? [0, groundEnabled ? groundOffsetFor(shape,workspace.dimensions,workspace.lidAngles[index] ?? 0) : 0, 0] as Vec3 : position) }));
  const changeSelectedLid = (angle: number) => updateWorkspace(shape, (workspace) => ({
    ...workspace,
    lidAngles: workspace.lidAngles.map((value, index) => index === workspace.selectedIndex ? angle : value),
    positions: workspace.positions.map(([x,y,z], index) => index === workspace.selectedIndex && groundEnabled ? [x, Math.max(y,groundOffsetFor(shape,workspace.dimensions,angle)), z] as Vec3 : [x,y,z] as Vec3),
  }));
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
      <aside className="shape-panel" aria-label="图形选择"><div className="panel-title"><span>01</span><div><strong>选择图形</strong><small>两套独立工作区</small></div></div><div className="shape-list">
        {SHAPES.map((item) => { const Icon = item.icon; return <Button key={item.id} variant="ghost" className={`shape-button ${shape === item.id ? "is-active" : ""}`} onClick={() => setShape(item.id)} aria-pressed={shape === item.id}><span className="shape-icon"><Icon size={25} strokeWidth={1.55} /></span><span>{item.label}</span><i /></Button>; })}
      </div><div className="interaction-tip"><MousePointer2 size={18} /><p><strong>点中图形后拖动摆放</strong><span>拖动空白旋转 · 滚轮缩放</span></p></div></aside>
      <section className="viewport-panel" aria-label="3D 预览区">
        <div className="viewport-meta"><div><span className="eyebrow">PERSPECTIVE / {focalLength}mm</span><strong>{SHAPES.find((item) => item.id === shape)?.label} × {quantity}</strong></div><div className="view-actions"><Button className="capture-button" size="sm" onClick={saveJpg}><Download size={15}/>{captureStatus ? "已保存" : "拍照 JPG"}</Button><Button variant="ghost" size="sm" onClick={toggleGround} aria-pressed={groundEnabled}>{groundEnabled ? <Minus size={15}/> : <Plus size={15}/>} {groundEnabled ? "移除地面" : "添加地面"}</Button><Button variant="ghost" size="sm" onClick={() => setGridVisible((v) => !v)} aria-pressed={gridVisible}><Grid3X3 size={16} />网格</Button><Button variant="ghost" size="sm" onClick={resetView}><Redo2 size={15} />复位</Button></div></div>
        <div className={`canvas-stage ${captureStatus ? "is-captured" : ""}`}><canvas ref={canvasRef} tabIndex={0} aria-label="1比1画布，点中图形可自由拖动位置，拖动空白旋转视角"
          onPointerDown={(e) => { const rect=e.currentTarget.getBoundingClientRect(); const x=e.clientX-rect.left,y=e.clientY-rect.top; const hit=[...hitRegionsRef.current].sort((a,b)=>a.radius-b.radius).find((region)=>Math.hypot(x-region.x,y-region.y)<=region.radius+10); e.currentTarget.setPointerCapture(e.pointerId); if(hit)selectInstance(hit.index); pointerRef.current = { id:e.pointerId, x:e.clientX, y:e.clientY, action:hit?"object":"camera", objectIndex:hit?.index ?? -1 }; e.currentTarget.classList.add(hit?"is-moving-object":"is-dragging"); }}
          onPointerMove={(e) => { const p=pointerRef.current; if(!p||p.id!==e.pointerId)return; const dx=e.clientX-p.x,dy=e.clientY-p.y; if(p.action==="camera")setRotation((r)=>({yaw:r.yaw+dx*.009,pitch:Math.max(-1.48,Math.min(1.48,r.pitch+dy*.009))})); else { const canvas=e.currentTarget; const factor=2.45/(Math.max(220,Math.min(canvas.clientWidth,canvas.clientHeight))*zoom); const [wx,wy,wz]=inverseRotate([dx*factor,-dy*factor,0],rotation.yaw,rotation.pitch); updateWorkspace(shape,(workspace)=>({ ...workspace, positions:workspace.positions.map((position,index)=>index===p.objectIndex?[position[0]+wx,groundEnabled?Math.max(position[1]+wy,groundOffsetFor(shape,workspace.dimensions,workspace.lidAngles[index] ?? 0)):position[1]+wy,position[2]+wz] as Vec3:position) })); } pointerRef.current={...p,x:e.clientX,y:e.clientY}; }}
          onPointerUp={(e) => { pointerRef.current=null; e.currentTarget.classList.remove("is-dragging","is-moving-object"); }} onPointerCancel={(e) => { pointerRef.current=null; e.currentTarget.classList.remove("is-dragging","is-moving-object"); }} onDoubleClick={resetView}
          onWheel={(e) => { e.preventDefault(); setZoom((z)=>Math.max(MIN_ZOOM,Math.min(zoomLimit,z-e.deltaY*.0015))); }}
          onKeyDown={(e) => { if(e.key==="ArrowLeft")setRotation((r)=>({...r,yaw:r.yaw-.08})); if(e.key==="ArrowRight")setRotation((r)=>({...r,yaw:r.yaw+.08})); if(e.key==="ArrowUp")setRotation((r)=>({...r,pitch:Math.max(-1.48,r.pitch-.08)})); if(e.key==="ArrowDown")setRotation((r)=>({...r,pitch:Math.min(1.48,r.pitch+.08)})); if(e.key==="0")resetView(); }} />
          <div className="canvas-ratio-label">1:1 极限画布</div><div className="dimension-badge badge-width"><span>W</span>{dimensions.width.toFixed(1)} cm</div><div className="dimension-badge badge-height"><span>H</span>{dimensions.height.toFixed(1)} cm</div><div className="dimension-badge badge-depth"><span>D</span>{dimensions.depth.toFixed(1)} cm</div><div className="camera-readout"><Camera size={14}/><span>{focalLength}mm · {fieldOfView}°</span></div><div className="zoom-readout"><Rotate3D size={15} /><span>{Math.round(zoom*100)}% / 极限 {Math.round(zoomLimit*100)}%</span></div><div className="capture-confirmation"><Camera size={16}/>JPG 已保存</div>
          {groundEnabled && <div className="ground-status"><span className="status-dot"/>固定地面 · 防穿透</div>}
        </div>
        <div className="view-presets" aria-label="视角预设"><span>快速视角</span><Button variant="outline" size="sm" onClick={()=>setView("front")}>正面</Button><Button variant="outline" size="sm" onClick={()=>setView("top")}>顶面</Button><Button variant="outline" size="sm" onClick={()=>setView("iso")}>等轴</Button></div>
      </section>
      <aside className="control-panel" aria-label="模型与摄像机控制"><div className="panel-title"><span>02</span><div><strong>调整尺寸</strong><small>实时改变比例</small></div></div><div className="controls">
        <DimensionControl label="长度" axis="W" value={dimensions.width} unit="cm" onChange={(v)=>changeDimension("width",v)} /><DimensionControl label="高度" axis="H" value={dimensions.height} unit="cm" onChange={(v)=>changeDimension("height",v)} /><DimensionControl label="深度" axis="D" value={dimensions.depth} unit="cm" onChange={(v)=>changeDimension("depth",v)} />
        <div className="scale-control"><div className="control-heading"><span><Maximize2 size={16}/>整体大小</span><output>{dimensions.scale.toFixed(1)}×</output></div><Slider aria-label="整体大小" min={.5} max={2} step={.1} value={[dimensions.scale]} onValueChange={([next])=>changeDimension("scale",next)} /><div className="slider-ends"><span>0.5×</span><span>2.0×</span></div></div>
      </div><div className="size-summary"><span>当前尺寸</span><strong>{dimensions.width.toFixed(1)} × {dimensions.height.toFixed(1)} × {dimensions.depth.toFixed(1)}</strong><small>单位：厘米 · 比例 {dimensions.scale.toFixed(1)}×</small></div>
        <section className="editor-section instance-section" aria-label="数量与自由摆放">
          <div className="section-heading"><span><Copy size={16}/>数量与自由摆放</span><output>{quantity} 个</output></div>
          <div className="quantity-stepper"><Button variant="outline" size="icon" aria-label="减少数量" disabled={quantity<=1} onClick={()=>changeQuantity(quantity-1)}><Minus size={14}/></Button><strong>{quantity}</strong><Button variant="outline" size="icon" aria-label="增加数量" disabled={quantity>=12} onClick={()=>changeQuantity(quantity+1)}><Plus size={14}/></Button></div>
          <Slider aria-label="几何图形数量" min={1} max={12} step={1} value={[quantity]} onValueChange={([next])=>changeQuantity(next)} />
          <p className="free-layout-tip"><Move3D size={14}/>点中画布里的图形并直接拖动，不使用预设排列。</p>
          <div className="instance-picker" aria-label="选择要编辑的形体">{positions.map((_,index)=><Button key={index} size="sm" variant={selectedIndex===index?"default":"outline"} onClick={()=>selectInstance(index)} aria-pressed={selectedIndex===index}>{index+1}</Button>)}</div>
          <div className="position-editor">
            <div className="section-heading"><span><LocateFixed size={15}/>形体 {selectedIndex+1} 坐标</span><Button variant="ghost" size="sm" onClick={resetSelectedPosition}>归零</Button></div>
            {([0,1,2] as const).map((axis)=>{ const labels=["X 左右","Y 上下","Z 前后"]; const axisNames=["X","Y","Z"]; const minimum=axis===1&&groundEnabled?groundMinY:-2.5; return <div className="position-row" key={axis}><label><b>{axisNames[axis]}</b>{labels[axis]}</label><Slider aria-label={`${labels[axis]}位置`} min={minimum} max={2.5} step={.01} value={[positions[selectedIndex]?.[axis] ?? 0]} onValueChange={([next])=>changePosition(axis,next)} /><input aria-label={`${labels[axis]}坐标值`} type="number" min={minimum} max="2.5" step="0.01" value={(positions[selectedIndex]?.[axis] ?? 0).toFixed(2)} onChange={(e)=>changePosition(axis,Math.max(minimum,Math.min(2.5,Number(e.target.value)||0)))} /></div>; })}
          </div>
        </section>
        <section className="editor-section camera-section" aria-label="透视摄像机">
          <div className="section-heading"><span><Camera size={16}/>透视摄像机</span><output>{focalLength} mm</output></div>
          <div className="lens-presets">{[24,35,50,85,135].map((lens)=><Button key={lens} size="sm" variant={focalLength===lens?"default":"outline"} onClick={()=>setFocalLength(lens)}>{lens}</Button>)}</div>
          <Slider aria-label="摄像机焦距" min={18} max={135} step={1} value={[focalLength]} onValueChange={([next])=>setFocalLength(next)} />
          <div className="camera-meta"><span>18mm 广角</span><b>视场角 {fieldOfView}°</b><span>135mm 长焦</span></div>
        </section>
        <section className="editor-section lid-section" aria-label="顶部盖面编辑">
          <div className="section-heading"><span><DoorOpen size={17}/>形体 {selectedIndex+1} 顶部盖面</span><output>{Math.round(selectedLidAngle)}°</output></div>
          <p>只控制当前选中的形体；{shape === "box" ? "沿长方体后边缘铰链翻动" : "沿圆柱体后侧铰链翻动"}。</p>
          <Slider aria-label={`形体 ${selectedIndex+1} 盖面开启角度`} min={0} max={200} step={1} value={[selectedLidAngle]} onValueChange={([next])=>changeSelectedLid(next)} />
          <div className="lid-angle-range"><span>0° 关闭</span><span>200° 翻至背后</span></div>
          <div className="lid-presets"><Button variant="outline" size="sm" onClick={()=>animateLid(0)}>关闭</Button><Button variant="outline" size="sm" onClick={()=>animateLid(60)}>半开</Button><Button variant="outline" size="sm" onClick={()=>animateLid(110)}>打开</Button><Button size="sm" onClick={()=>animateLid(180)}>翻至背面</Button></div>
        </section>
      </aside>
    </div>
  </main>;
}
