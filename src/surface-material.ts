export function updateSurfaceSelection(current: string[], surfaceId: string, append: boolean) {
  if (!append) return [surfaceId];
  return current.includes(surfaceId) ? current.filter((value) => value !== surfaceId) : [...current, surfaceId];
}

export function textureSizeFromPercent(value: number) {
  return Math.max(25, Math.min(400, Number.isFinite(value) ? value : 25)) / 100;
}

export function cloneInstanceMaterials<T>(materials: Record<string,T>, sourceIndex: number, targetIndex: number) {
  const prefix = `${sourceIndex}:`;
  const result = { ...materials };
  Object.entries(materials).forEach(([key,value]) => {
    if (key.startsWith(prefix)) result[`${targetIndex}:${key.slice(prefix.length)}`] = value;
  });
  return result;
}
