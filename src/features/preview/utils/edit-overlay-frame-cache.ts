const DEFAULT_EDIT_OVERLAY_CACHE_MAX = 180;

const cache = new Map<string, ImageBitmap>();

export function getEditOverlayFrameCacheKey(
  src: string,
  sourceTime: number,
  quantumSeconds: number,
): string {
  const quantized = Math.round(sourceTime / quantumSeconds) * quantumSeconds;
  return `${src}::${quantized.toFixed(6)}`;
}

export function getCachedEditOverlayFrame(key: string): ImageBitmap | undefined {
  const bitmap = cache.get(key);
  if (!bitmap) {
    return undefined;
  }

  // Touch entry to preserve recent frames during drag reversals.
  cache.delete(key);
  cache.set(key, bitmap);
  return bitmap;
}

export function hasCachedEditOverlayFrame(key: string): boolean {
  return cache.has(key);
}

export function putCachedEditOverlayFrame(
  key: string,
  bitmap: ImageBitmap,
  maxEntries: number = DEFAULT_EDIT_OVERLAY_CACHE_MAX,
): void {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    bitmap.close();
    return;
  }

  cache.set(key, bitmap);
  while (cache.size > Math.max(1, maxEntries)) {
    const oldest = cache.entries().next().value as [string, ImageBitmap] | undefined;
    if (!oldest) {
      break;
    }
    const [oldestKey, oldestBitmap] = oldest;
    cache.delete(oldestKey);
    oldestBitmap.close();
  }
}

export function clearEditOverlayFrameCache(): void {
  for (const bitmap of cache.values()) {
    bitmap.close();
  }
  cache.clear();
}

export function getEditOverlayFrameCacheSize(): number {
  return cache.size;
}
