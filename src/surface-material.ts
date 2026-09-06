export function updateSurfaceSelection(current: string[], surfaceId: string, append: boolean) {
  if (!append) return [surfaceId];
  return current.includes(surfaceId) ? current.filter((value) => value !== surfaceId) : [...current, surfaceId];
}

export function textureSizeFromPercent(value: number) {
  return Math.max(25, Math.min(400, Number.isFinite(value) ? value : 25)) / 100;
}
