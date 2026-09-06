export type OpeningShape = 'rectangle' | 'rounded-rectangle' | 'circle' | 'ellipse';
export type OpeningPoint = [number, number, number];
export type GarmentOpening = {
  id: string;
  surfaceId: 'front' | 'back' | 'side';
  shape: OpeningShape;
  u: number;
  v: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  cornerRadius: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function rotatePoint(x: number, y: number, rotation: number) {
  const angle = rotation * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [x * cosine - y * sine, x * sine + y * cosine] as const;
}

export function openingShapeLabel(shape: OpeningShape) {
  return ({ rectangle:'矩形', 'rounded-rectangle':'圆角矩形', circle:'圆形', ellipse:'椭圆形' } as const)[shape];
}

/** Clockwise normalized UV outline for one opening. No capsule shape is intentionally provided. */
export function openingContourUv(opening: GarmentOpening): [number, number][] {
  const width = clamp(opening.width * opening.scale, .01, .9);
  const height = clamp(opening.height * opening.scale, .01, .9);
  let points: [number, number][];
  if (opening.shape === 'rectangle') {
    points = [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]];
  } else if (opening.shape === 'rounded-rectangle') {
    const radius = Math.min(width, height) * .5 * clamp(opening.cornerRadius, 0, 1);
    const corners = [[width/2-radius,-height/2+radius],[width/2-radius,height/2-radius],[-width/2+radius,height/2-radius],[-width/2+radius,-height/2+radius]] as const;
    const starts = [-Math.PI/2,0,Math.PI/2,Math.PI];
    points = corners.flatMap(([cx,cy], cornerIndex) => Array.from({ length:6 }, (_, pointIndex) => {
      const angle = starts[cornerIndex] + pointIndex / 5 * Math.PI/2;
      return [cx + Math.cos(angle)*radius, cy + Math.sin(angle)*radius] as [number,number];
    }));
  } else {
    const radiusX = width/2;
    const radiusY = opening.shape === 'circle' ? width/2 : height/2;
    points = Array.from({ length:32 }, (_, index) => {
      const angle = -Math.PI/2 + index / 32 * Math.PI*2;
      return [Math.cos(angle)*radiusX, Math.sin(angle)*radiusY] as [number,number];
    });
  }
  return points.map(([x,y]) => {
    const [rx,ry] = rotatePoint(x,y,opening.rotation);
    return [opening.u + rx, opening.v + ry];
  });
}

export function openingsOverlap(first: GarmentOpening, second: GarmentOpening, margin = .012) {
  const bounds = (opening: GarmentOpening) => {
    const contour = openingContourUv(opening);
    return { minU:Math.min(...contour.map(([u])=>u)), maxU:Math.max(...contour.map(([u])=>u)), minV:Math.min(...contour.map(([,v])=>v)), maxV:Math.max(...contour.map(([,v])=>v)) };
  };
  const a=bounds(first), b=bounds(second);
  return a.minU < b.maxU+margin && a.maxU+margin > b.minU && a.minV < b.maxV+margin && a.maxV+margin > b.minV;
}

export function openingContourOnFace(opening: GarmentOpening, facePoints: OpeningPoint[]) {
  const xs = facePoints.map((point) => point[0]), ys = facePoints.map((point) => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const z = facePoints.reduce((sum, point) => sum + point[2], 0) / Math.max(1, facePoints.length);
  const rangeX = Math.max(1e-6,maxX-minX), rangeY = Math.max(1e-6,maxY-minY);
  return openingContourUv(opening).map(([u,v]) => {
    const correctedV = opening.shape === 'circle' ? opening.v + (v-opening.v)*rangeX/rangeY : v;
    return [minX + u*rangeX, maxY - correctedV*rangeY, z] as OpeningPoint;
  });
}

export function openingWallQuads(opening: GarmentOpening, facePoints: OpeningPoint[], depth: number) {
  const outer = openingContourOnFace(opening,facePoints);
  const direction = Math.sign(outer[0]?.[2] ?? 1) || 1;
  const inner = outer.map(([x,y,z]) => [x,y,z-direction*Math.abs(depth)] as OpeningPoint);
  return outer.map((point,index) => [point,outer[(index+1)%outer.length],inner[(index+1)%inner.length],inner[index]] as OpeningPoint[]);
}

function interpolatePoint(first: OpeningPoint, second: OpeningPoint, amount: number) {
  return first.map((value,axis) => value+(second[axis]-value)*amount) as OpeningPoint;
}

/** Maps normalized UV coordinates around the extruded perimeter and across its depth. */
export function openingContourOnSide(opening: GarmentOpening, sideFaces: OpeningPoint[][]) {
  if (!sideFaces.length) return [];
  return openingContourUv(opening).map(([rawU,rawV]) => {
    const u = ((rawU%1)+1)%1;
    const progress = Math.min(sideFaces.length-1e-8,u*sideFaces.length);
    const face = sideFaces[Math.floor(progress)];
    const amount = progress-Math.floor(progress);
    const back = interpolatePoint(face[0],face[1],amount);
    const front = interpolatePoint(face[3],face[2],amount);
    return interpolatePoint(back,front,clamp(rawV,0,1));
  });
}

export function openingSideWallQuads(opening: GarmentOpening, sideFaces: OpeningPoint[][], depth: number) {
  const outer = openingContourOnSide(opening,sideFaces);
  const allPoints = sideFaces.flat();
  const centerX = allPoints.reduce((sum,point)=>sum+point[0],0)/Math.max(1,allPoints.length);
  const centerY = allPoints.reduce((sum,point)=>sum+point[1],0)/Math.max(1,allPoints.length);
  const inner = outer.map(([x,y,z]) => {
    const distance = Math.hypot(centerX-x,centerY-y)||1;
    return [x+(centerX-x)/distance*Math.abs(depth),y+(centerY-y)/distance*Math.abs(depth),z] as OpeningPoint;
  });
  const walls = outer.map((point,index) => [point,outer[(index+1)%outer.length],inner[(index+1)%inner.length],inner[index]] as OpeningPoint[]);
  return { walls, inner };
}
