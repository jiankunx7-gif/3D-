type Point = [number, number, number];
export type GarmentMaterial = 'body' | 'trim' | 'inside' | 'hook';
type Face = { points: Point[]; material: GarmentMaterial };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Normalized upper edge of the cover. The centre remains fixed while the shoulders drop. */
export function garmentTopY(x: number, roundness: number) {
  const radius = clamp01(roundness / 100) * .46;
  const normalizedX = Math.max(-1, Math.min(1, x / .5));
  return .5 - radius + radius * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
}

export function garmentHookAnchors(roundness: number, hookCount: number) {
  const count = Math.max(0, Math.min(6, Math.round(hookCount)));
  if (!count) return [];
  return Array.from({ length: count }, (_, index) => {
    const x = count === 1 ? 0 : -.34 + (index / (count - 1)) * .68;
    return [x, garmentTopY(x, roundness)] as const;
  });
}

function ribbonSegment(a: Point, b: Point, width: number, depth: number): Face[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length * width, ny = dx / length * width;
  const front: Point[] = [[a[0] + nx, a[1] + ny, depth], [b[0] + nx, b[1] + ny, depth], [b[0] - nx, b[1] - ny, depth], [a[0] - nx, a[1] - ny, depth]];
  const back = front.map(([x, y]) => [x, y, -depth] as Point);
  const faces: Face[] = [{ material: 'hook', points: front }, { material: 'hook', points: [...back].reverse() }];
  for (let index = 0; index < 4; index++) {
    const next = (index + 1) % 4;
    faces.push({ material: 'hook', points: [front[index], front[next], back[next], back[index]] });
  }
  return faces;
}

/**
 * Parametric suit cover rebuilt from the concept silhouette. It does not load or
 * depend on the uploaded OBJ: width, height, thickness, crown and hooks are all live geometry.
 */
export function garmentFaces(
  dimensions: { width: number; height: number; depth: number; scale: number },
  roundness = 72,
  hookCount = 0,
): Face[] {
  const faces: Face[] = [];
  const segments = 24;
  const shoulderY = garmentTopY(.5, roundness);
  const outline: [number, number][] = [[-.5, -.5], [.5, -.5], [.5, shoulderY]];
  for (let index = 1; index <= segments; index++) {
    const theta = (index / segments) * Math.PI;
    const x = Math.cos(theta) * .5;
    outline.push([x, garmentTopY(x, roundness)]);
  }

  const ring = (z: number, inset: number): Point[] => outline.map(([x, y]) => [x * (1 - inset), y * (1 - inset), z]);
  const rings = [ring(-.5, .035), ring(-.43, 0), ring(.43, 0), ring(.5, .035)];
  faces.push({ material: 'body', points: [...rings[0]].reverse() }, { material: 'body', points: rings[3] });
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
    for (let pointIndex = 0; pointIndex < outline.length; pointIndex++) {
      const next = (pointIndex + 1) % outline.length;
      faces.push({ material: ringIndex === 1 ? 'body' : 'trim', points: [rings[ringIndex][pointIndex], rings[ringIndex][next], rings[ringIndex + 1][next], rings[ringIndex + 1][pointIndex]] });
    }
  }

  // Optional component: each hook is generated from the current crown and is therefore always attached.
  for (const [anchorX, anchorY] of garmentHookAnchors(roundness, hookCount)) {
    const path: Point[] = [[anchorX, anchorY - .004, 0], [anchorX, anchorY + .055, 0]];
    const radius = .047;
    const centerY = anchorY + .095;
    for (let index = 0; index <= 16; index++) {
      const theta = -Math.PI / 2 + (index / 16) * Math.PI * 1.55;
      path.push([anchorX + Math.cos(theta) * radius, centerY + Math.sin(theta) * radius, 0]);
    }
    for (let index = 1; index < path.length; index++) faces.push(...ribbonSegment(path[index - 1], path[index], .006, .018));
  }

  const scaleX = .82 * dimensions.width * dimensions.scale;
  const scaleY = 1.38 * dimensions.height * dimensions.scale;
  const scaleZ = .34 * dimensions.depth * dimensions.scale;
  return faces.map(({ material, points }) => ({
    material,
    points: points.map(([x, y, z]) => [x * scaleX, y * scaleY, z * scaleZ] as Point),
  }));
}
