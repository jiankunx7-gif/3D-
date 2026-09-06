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

export function garmentBottomY(height: number) {
  return .5 - Math.max(.5, height);
}

export function garmentHookAnchor(roundness: number) {
  return [0, garmentTopY(0, roundness)] as const;
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
): Face[] {
  const faces: Face[] = [];
  const segments = 24;
  const shoulderY = garmentTopY(.5, roundness);
  const bottomY = garmentBottomY(dimensions.height);
  const outline: [number, number][] = [[-.5, bottomY], [.5, bottomY], [.5, shoulderY]];
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

  // One circular hook is always attached to the crown centre. Height only moves the lower edge.
  const [anchorX, anchorY] = garmentHookAnchor(roundness);
  faces.push(...ribbonSegment([anchorX, anchorY - .004, 0], [anchorX, anchorY + .032, 0], .006, .018));
  const hookRadius = .052;
  const hookCenterY = anchorY + .083;
  const hookPath: Point[] = [];
  for (let index = 0; index <= 24; index++) {
    const theta = -Math.PI / 2 + (index / 24) * Math.PI * 2;
    hookPath.push([anchorX + Math.cos(theta) * hookRadius, hookCenterY + Math.sin(theta) * hookRadius, 0]);
  }
  for (let index = 1; index < hookPath.length; index++) faces.push(...ribbonSegment(hookPath[index - 1], hookPath[index], .006, .018));

  const scaleX = .82 * dimensions.width * dimensions.scale;
  const scaleY = 1.38 * dimensions.scale;
  const scaleZ = .34 * dimensions.depth * dimensions.scale;
  const hookScale = .82 * dimensions.scale;
  const hookAnchorY = garmentHookAnchor(roundness)[1];
  return faces.map(({ material, points }) => ({
    material,
    points: points.map(([x, y, z]) => material === 'hook'
      ? [x * hookScale, hookAnchorY * scaleY + (y - hookAnchorY) * hookScale, z * hookScale] as Point
      : [x * scaleX, y * scaleY, z * scaleZ] as Point),
  }));
}
