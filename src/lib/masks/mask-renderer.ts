/**
 * CPU-side mask renderer: bezier mask paths -> item-sized mask canvases/ImageData.
 *
 * Renders at the requested resolution; callers can pass reduced dimensions
 * for performance and then scale up the result when compositing.
 */

import type { ClipMask, MaskVertex, MaskMode } from '@/types/masks';

const MASK_CACHE_LIMIT = 48;

let blurCanvas: OffscreenCanvas | null = null;
let blurCtx: OffscreenCanvasRenderingContext2D | null = null;
let readbackCanvas: OffscreenCanvas | null = null;
let readbackCtx: OffscreenCanvasRenderingContext2D | null = null;
const maskCanvasCache = new Map<string, OffscreenCanvas>();

function ensureBlurCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!blurCanvas || blurCanvas.width !== w || blurCanvas.height !== h) {
    blurCanvas = new OffscreenCanvas(w, h);
    blurCtx = blurCanvas.getContext('2d')!;
  }
  return blurCtx!;
}

function ensureReadbackCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!readbackCanvas || readbackCanvas.width !== w || readbackCanvas.height !== h) {
    readbackCanvas = new OffscreenCanvas(w, h);
    readbackCtx = readbackCanvas.getContext('2d', { willReadFrequently: true })!;
  }
  return readbackCtx!;
}

function resetContext(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
}

function getCompositeOp(mode: MaskMode): GlobalCompositeOperation {
  switch (mode) {
    case 'add': return 'lighter';
    case 'subtract': return 'destination-out';
    case 'intersect': return 'destination-in';
  }
}

function drawMaskPath(
  ctx: OffscreenCanvasRenderingContext2D,
  vertices: MaskVertex[],
  w: number,
  h: number,
): void {
  if (vertices.length < 2) return;

  ctx.beginPath();
  const first = vertices[0]!;
  ctx.moveTo(first.position[0] * w, first.position[1] * h);

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % vertices.length]!;

    const outH = curr.outHandle;
    const inH = next.inHandle;

    const isStraight =
      outH[0] === 0 && outH[1] === 0 && inH[0] === 0 && inH[1] === 0;

    if (isStraight) {
      ctx.lineTo(next.position[0] * w, next.position[1] * h);
    } else {
      ctx.bezierCurveTo(
        (curr.position[0] + outH[0]) * w,
        (curr.position[1] + outH[1]) * h,
        (next.position[0] + inH[0]) * w,
        (next.position[1] + inH[1]) * h,
        next.position[0] * w,
        next.position[1] * h,
      );
    }
  }
  ctx.closePath();
}

function buildMaskCacheKey(
  masks: ClipMask[],
  width: number,
  height: number,
): string {
  const parts = [`${width}x${height}`];
  for (const mask of masks) {
    parts.push(mask.id, mask.mode, `${mask.opacity}`, `${mask.feather}`, mask.inverted ? '1' : '0');
    for (const vertex of mask.vertices) {
      parts.push(
        `${vertex.position[0]},${vertex.position[1]}`,
        `${vertex.inHandle[0]},${vertex.inHandle[1]}`,
        `${vertex.outHandle[0]},${vertex.outHandle[1]}`,
      );
    }
  }
  return parts.join('|');
}

function cacheMaskCanvas(key: string, canvas: OffscreenCanvas): void {
  if (maskCanvasCache.has(key)) {
    maskCanvasCache.delete(key);
  }
  maskCanvasCache.set(key, canvas);

  if (maskCanvasCache.size <= MASK_CACHE_LIMIT) return;

  const oldestKey = maskCanvasCache.keys().next().value;
  if (oldestKey !== undefined) {
    maskCanvasCache.delete(oldestKey);
  }
}

function renderMasksToContext(
  ctx: OffscreenCanvasRenderingContext2D,
  masks: ClipMask[],
  width: number,
  height: number,
): void {
  resetContext(ctx, width, height);

  const firstMode = masks[0]?.mode ?? 'add';
  ctx.fillStyle = firstMode === 'add' ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (const mask of masks) {
    ctx.globalAlpha = mask.opacity;
    drawMaskPath(ctx, mask.vertices, width, height);

    if (mask.inverted) {
      if (mask.mode === 'add' || mask.mode === 'intersect') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffffff';
      }
    } else {
      ctx.globalCompositeOperation = getCompositeOp(mask.mode);
      ctx.fillStyle = '#ffffff';
    }

    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function normalizeMaskAlpha(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i]!;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Render mask paths to an item-sized canvas.
 * White = masked (visible), black = unmasked (hidden).
 */
export function renderMasksToCanvas(
  masks: ClipMask[],
  width: number,
  height: number,
): OffscreenCanvas {
  const enabled = masks.filter((m) => m.enabled && m.vertices.length >= 2);
  const cacheKey = buildMaskCacheKey(enabled, width, height);
  const cachedCanvas = maskCanvasCache.get(cacheKey);
  if (cachedCanvas) {
    cacheMaskCanvas(cacheKey, cachedCanvas);
    return cachedCanvas;
  }

  const outputCanvas = new OffscreenCanvas(width, height);
  const outputCtx = outputCanvas.getContext('2d')!;
  renderMasksToContext(outputCtx, enabled, width, height);

  const maxFeather = enabled.reduce((max, m) => Math.max(max, m.feather), 0);
  if (maxFeather > 0.5) {
    const blurContext = ensureBlurCanvas(width, height);
    resetContext(blurContext, width, height);
    blurContext.filter = `blur(${maxFeather}px)`;
    blurContext.drawImage(outputCanvas, 0, 0);
    blurContext.filter = 'none';

    resetContext(outputCtx, width, height);
    outputCtx.drawImage(blurCanvas!, 0, 0);
  }

  // Keep CPU destination-in and GPU mask sampling in sync by storing the
  // mask strength in alpha as well as RGB. Cache misses pay this cost once.
  normalizeMaskAlpha(outputCtx, width, height);

  cacheMaskCanvas(cacheKey, outputCanvas);
  return outputCanvas;
}

/**
 * Render mask paths to grayscale ImageData.
 * White = masked (visible), black = unmasked (hidden).
 */
export function renderMasks(
  masks: ClipMask[],
  width: number,
  height: number,
): ImageData {
  const renderedCanvas = renderMasksToCanvas(masks, width, height);
  const ctx = ensureReadbackCanvas(width, height);
  resetContext(ctx, width, height);
  ctx.drawImage(renderedCanvas, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
