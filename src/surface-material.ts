export function updateSurfaceSelection(current: string[], surfaceId: string, append: boolean) {
  if (!append) return [surfaceId];
  return current.includes(surfaceId) ? current.filter((value) => value !== surfaceId) : [...current, surfaceId];
}

export function textureSizeFromPercent(value: number) {
  return Math.max(25, Math.min(400, Number.isFinite(value) ? value : 25)) / 100;
}

export function normalizedModelColor(value: string, fallback = '#ee6a35') {
  const candidate = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
}

export function shadedModelColor(value: string, factor: number) {
  const color = normalizedModelColor(value);
  const shade = Math.max(0, Math.min(1.35, Number.isFinite(factor) ? factor : 1));
  const channels = [1, 3, 5].map((start) => Math.max(0, Math.min(255, Math.round(Number.parseInt(color.slice(start, start + 2), 16) * shade))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function decalPercent(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)) / 100;
}

export function scaledDecalDimensions(width: number, height: number, scale: number) {
  const safeScale = Math.max(.1, Math.min(4, Number.isFinite(scale) ? scale : 1));
  return {
    width: Math.max(.005, width * safeScale),
    height: Math.max(.005, height * safeScale),
  };
}

export function cloneInstanceMaterials<T>(materials: Record<string,T>, sourceIndex: number, targetIndex: number) {
  const prefix = `${sourceIndex}:`;
  const result = { ...materials };
  Object.entries(materials).forEach(([key,value]) => {
    if (key.startsWith(prefix)) result[`${targetIndex}:${key.slice(prefix.length)}`] = value;
  });
  return result;
}
