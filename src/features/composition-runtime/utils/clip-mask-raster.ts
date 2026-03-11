import type { ClipMask } from '@/types/masks';
import { renderMasks } from '@/infrastructure/gpu/masks';

const FEATHERED_MASK_MAX_DIMENSION = 960;
const MASK_URL_CACHE_MAX_ENTRIES = 48;
const maskUrlCache = new Map<string, string>();

type SvgMaskPath = { path: string; strokeWidth: number };

export function shouldUseComplexClipMask(masks: ClipMask[]): boolean {
  return masks.some((m) =>
    m.feather > 0.5 || m.opacity < 0.99 || m.inverted || m.mode !== 'add'
  );
}

export function getMaxClipMaskFeather(masks: ClipMask[]): number {
  return masks.reduce((max, mask) => Math.max(max, mask.feather), 0);
}

export function getClipMaskRasterScale(
  masks: ClipMask[],
  width: number,
  height: number,
): number {
  const maxFeather = getMaxClipMaskFeather(masks);
  if (maxFeather <= 0.5) return 1;

  const maxDimension = Math.max(1, Math.round(width), Math.round(height));
  if (maxDimension <= FEATHERED_MASK_MAX_DIMENSION) return 1;

  return FEATHERED_MASK_MAX_DIMENSION / maxDimension;
}

export function getClipMaskRasterSize(
  masks: ClipMask[],
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const scale = getClipMaskRasterScale(masks, width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function buildClipMaskCacheKey(
  masks: ClipMask[],
  width: number,
  height: number,
  scale: number,
): string {
  return JSON.stringify({
    width,
    height,
    scale: Math.round(scale * 1000) / 1000,
    masks: masks.map((mask) => ({
      id: mask.id,
      mode: mask.mode,
      opacity: Math.round(mask.opacity * 1000) / 1000,
      feather: Math.round(mask.feather * 1000) / 1000,
      inverted: mask.inverted,
      enabled: mask.enabled,
      vertices: mask.vertices.map((vertex) => ({
        position: vertex.position,
        inHandle: vertex.inHandle,
        outHandle: vertex.outHandle,
      })),
    })),
  });
}

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

/**
 * CSS masks default to alpha masking. Convert the grayscale output from the
 * CPU mask renderer into a white image whose alpha encodes the mask strength.
 */
export function remapMaskImageDataToAlpha(imageData: ImageData): ImageData {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i] ?? 0;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = alpha;
  }
  return imageData;
}

/**
 * Rasterize complex clip masks once and reuse them as a static alpha-mask image.
 * Returns null when browser primitives are unavailable so callers can fall back
 * to the existing SVG mask path.
 */
export function renderClipMasksToDataUrl(
  masks: ClipMask[],
  width: number,
  height: number,
): string | null {
  const { width: maskWidth, height: maskHeight, scale } = getClipMaskRasterSize(masks, width, height);

  if (
    maskWidth <= 0
    || maskHeight <= 0
    || typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }

  const cacheKey = buildClipMaskCacheKey(masks, maskWidth, maskHeight, scale);
  const cached = getCachedMaskUrl(cacheKey);
  if (cached) return cached;

  const rasterMasks = scale === 1
    ? masks
    : masks.map((mask) => ({
      ...mask,
      feather: mask.feather * scale,
    }));

  let imageData: ImageData;
  try {
    imageData = renderMasks(rasterMasks, maskWidth, maskHeight);
  } catch {
    return null;
  }

  const ctx = getMaskCanvasContext(maskWidth, maskHeight);
  if (!ctx) return null;

  ctx.putImageData(remapMaskImageDataToAlpha(imageData), 0, 0);
  const dataUrl = ctx.canvas.toDataURL('image/png');
  setCachedMaskUrl(cacheKey, dataUrl);
  return dataUrl;
}

export function renderSvgMaskPathsToDataUrl(
  paths: SvgMaskPath[],
  width: number,
  height: number,
  feather: number,
  invert: boolean,
): string | null {
  const { width: maskWidth, height: maskHeight, scale } = getClipMaskRasterSize(
    [{ id: 'svg-mask', vertices: [], mode: 'add', opacity: 1, feather, inverted: invert, enabled: true }],
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
