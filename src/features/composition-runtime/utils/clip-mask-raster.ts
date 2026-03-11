const FEATHERED_MASK_MAX_DIMENSION = 960;
const MASK_URL_CACHE_MAX_ENTRIES = 48;
const maskUrlCache = new Map<string, string>();

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

function getMaskCanvasContext(
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
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
    scale: Math.round(scale * 1000) / 1000,
    feather: Math.round(feather * 1000) / 1000,
    invert,
    paths,
  });
  const cached = getCachedMaskUrl(cacheKey);
  if (cached) return cached;

  const ctx = getMaskCanvasContext(maskWidth, maskHeight);
  if (!ctx) return null;

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
    const path2d = new Path2D(path);
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
