const FEATHERED_MASK_MAX_DIMENSION = 960;
const MASK_URL_CACHE_MAX_ENTRIES = 48;
const PATH2D_CACHE_MAX_ENTRIES = 256;
const maskUrlCache = new Map<string, string>();
const path2dCache = new Map<string, Path2D>();
let sharedMaskCanvas: HTMLCanvasElement | null = null;

type SvgMaskPath = { path: string; strokeWidth: number };

function getCachedMaskUrl(key: string): string | null {
  const cached = maskUrlCache.get(key);
  if (!cached) return null;

  maskUrlCache.delete(key);
  maskUrlCache.set(key, cached);
  return cached;
}

function setCachedMaskUrl(key: string, value: string): void {
  if (maskUrlCache.has(key)) {
    maskUrlCache.delete(key);
  }
  maskUrlCache.set(key, value);

  while (maskUrlCache.size > MASK_URL_CACHE_MAX_ENTRIES) {
    const oldestKey = maskUrlCache.keys().next().value;
    if (!oldestKey) break;
    maskUrlCache.delete(oldestKey);
  }
}

function getCachedPath2D(path: string): Path2D {
  const cached = path2dCache.get(path);
  if (cached) {
    path2dCache.delete(path);
    path2dCache.set(path, cached);
    return cached;
  }

  const path2d = new Path2D(path);
  path2dCache.set(path, path2d);
  while (path2dCache.size > PATH2D_CACHE_MAX_ENTRIES) {
    const oldestKey = path2dCache.keys().next().value;
    if (!oldestKey) break;
    path2dCache.delete(oldestKey);
  }
  return path2d;
}

function getMaskCanvasContext(
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;

  const sharedCanvas = sharedMaskCanvas ?? document.createElement('canvas');
  sharedMaskCanvas = sharedCanvas;
  if (sharedCanvas.width !== width) sharedCanvas.width = width;
  if (sharedCanvas.height !== height) sharedCanvas.height = height;
  try {
    return sharedCanvas.getContext('2d');
  } catch {
    return null;
  }
}

function roundCacheFloat(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hashSvgMaskPaths(paths: SvgMaskPath[]): string {
  let hash = 2166136261;
  for (const { path, strokeWidth } of paths) {
    for (let index = 0; index < path.length; index += 1) {
      hash ^= path.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= Math.round(strokeWidth * 1000);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getMaskRasterScale(
  feather: number,
  width: number,
  height: number,
): number {
  if (feather <= 0.5) return 1;

  const maxDimension = Math.max(1, Math.round(width), Math.round(height));
  if (maxDimension <= FEATHERED_MASK_MAX_DIMENSION) return 1;

  return FEATHERED_MASK_MAX_DIMENSION / maxDimension;
}

export function getMaskRasterSize(
  feather: number,
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const scale = getMaskRasterScale(feather, width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function renderSvgMaskPathsToDataUrl(
  paths: SvgMaskPath[],
  width: number,
  height: number,
  feather: number,
  invert: boolean,
): string | null {
  const { width: maskWidth, height: maskHeight, scale } = getMaskRasterSize(
    feather,
    width,
    height,
  );

  if (
    maskWidth <= 0
    || maskHeight <= 0
    || typeof document === 'undefined'
    || typeof Path2D === 'undefined'
  ) {
    return null;
  }

  const cacheKey = JSON.stringify({
    type: 'svg-mask',
    width: maskWidth,
    height: maskHeight,
    scale: roundCacheFloat(scale),
    feather: roundCacheFloat(feather),
    invert,
    pathHash: hashSvgMaskPaths(paths),
  });
  const cached = getCachedMaskUrl(cacheKey);
  if (cached) return cached;

  const ctx = getMaskCanvasContext(maskWidth, maskHeight);
  if (!ctx) return null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, maskWidth, maskHeight);
  if (invert) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, maskWidth, maskHeight);
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }

  const scaledFeather = feather * scale;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  if (scaledFeather > 0.5) {
    ctx.filter = `blur(${scaledFeather}px)`;
  }

  ctx.save();
  ctx.scale(scale, scale);
  for (const { path, strokeWidth } of paths) {
    const path2d = getCachedPath2D(path);
    ctx.fill(path2d);
    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth;
      ctx.stroke(path2d);
    }
  }
  ctx.restore();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';

  const dataUrl = ctx.canvas.toDataURL('image/png');
  setCachedMaskUrl(cacheKey, dataUrl);
  return dataUrl;
}
