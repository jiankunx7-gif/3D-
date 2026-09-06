type Point = [number, number, number];
type Face = { points: Point[]; material: 'body' | 'trim' | 'inside' };

// Unitless, stylized garment cover. Each control scales exactly one world axis.
export function garmentFaces(dimensions: { width: number; height: number; depth: number; scale: number }): Face[] {
  const faces: Face[] = [];
  const outline = [[-.45, -.5], [.45, -.5], [.5, -.48], [.5, .27], [.47, .31], [.12, .42], [-.12, .42], [-.47, .31], [-.5, .27], [-.5, -.48]];
  const ring = (z: number, inset: number): Point[] => outline.map(([x, y]) => [x * (1 - inset), y * (1 - inset), z]);
  const rings = [ring(-.5, .04), ring(-.4, 0), ring(.4, 0), ring(.5, .04)];
  faces.push({ material: 'body', points: [...rings[0]].reverse() }, { material: 'body', points: rings[3] });
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    faces.push({ material: 'body', points: [rings[r][i], rings[r][next], rings[r + 1][next], rings[r + 1][i]] });
  }
  // Slim zipper on the front; it scales with the bag and stays on its surface.
  faces.push({ material: 'inside', points: [[-.009, -.46, .502], [.009, -.46, .502], [.009, .37, .502], [-.009, .37, .502]] });
  faces.push({ material: 'trim', points: [[-.025, .29, .506], [.025, .29, .506], [.025, .34, .506], [-.025, .34, .506]] });
  // Extruded hook follows an open curve, without importing the dense source OBJ.
  const hook: [number, number][] = [[0, .408], [0, .442]];
  for (let i = 0; i <= 18; i++) {
    const theta = -Math.PI / 2 - i / 18 * Math.PI * 1.65;
    hook.push([.065 * Math.cos(theta), .469 + .027 * Math.sin(theta)]);
  }
  for (let i = 1; i < hook.length; i++) {
    const [ax, ay] = hook[i - 1], [bx, by] = hook[i];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len * .006, ny = (bx - ax) / len * .006;
    const a: Point[] = [[ax + nx, ay + ny, -.03], [bx + nx, by + ny, -.03], [bx - nx, by - ny, -.03], [ax - nx, ay - ny, -.03]];
    const b = a.map(([x, y]) => [x, y, .03] as Point);
    faces.push({ material: 'trim', points: a }, { material: 'trim', points: b });
    for (let j = 0; j < 4; j++) faces.push({ material: 'trim', points: [a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]] });
  }
  return faces.map(({ material, points }) => ({ material, points: points.map(([x, y, z]) => [x * .45 * dimensions.width * dimensions.scale, y * 1.2 * dimensions.height * dimensions.scale, z * .12 * dimensions.depth * dimensions.scale] as Point) }));
}
