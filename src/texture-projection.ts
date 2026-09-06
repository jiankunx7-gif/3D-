export type ProjectionPoint = [number, number, number];
export type UvPoint = [number, number];
const cleanZero = (value: number) => Object.is(value, -0) ? 0 : value;
const uv = (u: number, v: number): UvPoint => [cleanZero(u), cleanZero(v)];

function faceNormal(points: ProjectionPoint[]): ProjectionPoint {
  const origin = points[0] ?? [0, 0, 0];
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    const u: ProjectionPoint = [a[0] - origin[0], a[1] - origin[1], a[2] - origin[2]];
    const v: ProjectionPoint = [b[0] - origin[0], b[1] - origin[1], b[2] - origin[2]];
    const normal: ProjectionPoint = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...normal) > 1e-8) return normal;
  }
  return [0, 0, 1];
}

/** UVs from the dominant face normal, matching a seamless cubic/box projection. */
export function cubeProjectionUvs(points: ProjectionPoint[]): UvPoint[] {
  const normal = faceNormal(points);
  const [nx, ny, nz] = normal.map(Math.abs);
  if (nx >= ny && nx >= nz) return points.map(([, y, z]) => uv(normal[0] >= 0 ? -z : z, -y));
  if (ny >= nx && ny >= nz) return points.map(([x, , z]) => uv(x, normal[1] >= 0 ? z : -z));
  return points.map(([x, y]) => uv(normal[2] >= 0 ? x : -x, -y));
}

/** Maps a source UV triangle to a projected screen triangle. */
export function affineTriangleMap(source: [UvPoint, UvPoint, UvPoint], target: [UvPoint, UvPoint, UvPoint]) {
  const [[u0, v0], [u1, v1], [u2, v2]] = source;
  const determinant = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(determinant) < 1e-8) return null;
  const solve = (q0: number, q1: number, q2: number) => [
    (q0 * (v1 - v2) + q1 * (v2 - v0) + q2 * (v0 - v1)) / determinant,
    (q0 * (u2 - u1) + q1 * (u0 - u2) + q2 * (u1 - u0)) / determinant,
    (q0 * (u1 * v2 - u2 * v1) + q1 * (u2 * v0 - u0 * v2) + q2 * (u0 * v1 - u1 * v0)) / determinant,
  ] as const;
  const [a, b, c] = solve(target[0][0], target[1][0], target[2][0]);
  const [d, e, f] = solve(target[0][1], target[1][1], target[2][1]);
  return { a, b, c, d, e, f };
}

export function textureWorldPeriod(size: number) {
  return .36 * Math.max(.25, Math.min(4, size));
}
