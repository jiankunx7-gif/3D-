export type CollisionVec3 = [number, number, number];
export type CollisionBounds = { min: CollisionVec3; max: CollisionVec3 };

export const COLLISION_CLEARANCE = .012;

export function worldBounds(bounds: CollisionBounds, position: CollisionVec3): CollisionBounds {
  return {
    min: bounds.min.map((value, axis) => value + position[axis]) as CollisionVec3,
    max: bounds.max.map((value, axis) => value + position[axis]) as CollisionVec3,
  };
}

export function boundsOverlap(a: CollisionBounds, b: CollisionBounds, clearance = 0) {
  return ([0, 1, 2] as const).every((axis) => a.min[axis] < b.max[axis] + clearance && a.max[axis] > b.min[axis] - clearance);
}

/** Swept axis-aligned collision with axis-by-axis sliding and no tunnelling. */
export function resolveCollisionMove(
  current: CollisionVec3,
  desired: CollisionVec3,
  localBounds: CollisionBounds,
  obstacles: CollisionBounds[],
  clearance = COLLISION_CLEARANCE,
): CollisionVec3 {
  const resolved = [...current] as CollisionVec3;
  const axes: Array<0 | 1 | 2> = [0, 1, 2];
  axes.sort((a, b) => Math.abs(desired[b] - current[b]) - Math.abs(desired[a] - current[a]));
  for (const axis of axes) {
    const delta = desired[axis] - current[axis];
    if (Math.abs(delta) < 1e-9) continue;
    let target = desired[axis];
    for (const obstacle of obstacles) {
      const otherAxes = ([0, 1, 2] as const).filter((candidate) => candidate !== axis);
      const overlapsOtherAxes = otherAxes.every((otherAxis) =>
        localBounds.min[otherAxis] + resolved[otherAxis] < obstacle.max[otherAxis] - clearance &&
        localBounds.max[otherAxis] + resolved[otherAxis] > obstacle.min[otherAxis] + clearance
      );
      if (!overlapsOtherAxes) continue;
      const currentMin = localBounds.min[axis] + resolved[axis];
      const currentMax = localBounds.max[axis] + resolved[axis];
      if (delta > 0 && currentMax <= obstacle.min[axis] + clearance) {
        target = Math.min(target, obstacle.min[axis] - localBounds.max[axis] - clearance);
      } else if (delta < 0 && currentMin >= obstacle.max[axis] - clearance) {
        target = Math.max(target, obstacle.max[axis] - localBounds.min[axis] + clearance);
      }
    }
    resolved[axis] = target;
  }
  return resolved;
}

export function spawnBeside(localBounds: CollisionBounds, obstacles: CollisionBounds[], baseY: number, baseZ = 0): CollisionVec3 {
  if (!obstacles.length) return [0, baseY, baseZ];
  const rightEdge = Math.max(...obstacles.map((bounds) => bounds.max[0]));
  return [rightEdge - localBounds.min[0] + COLLISION_CLEARANCE, baseY, baseZ];
}
