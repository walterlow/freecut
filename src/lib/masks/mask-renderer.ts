/**
 * CPU-side mask renderer: bezier mask paths -> ImageData via OffscreenCanvas 2D.
 *
 * Renders at the requested resolution; callers can pass reduced dimensions
 * for performance — GPU sampling with linear filtering handles upscale.
 */

import type { ClipMask, MaskVertex, MaskMode } from '@/types/masks';

let maskCanvas: OffscreenCanvas | null = null;
let maskCtx: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!maskCanvas || maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas = new OffscreenCanvas(w, h);
    maskCtx = maskCanvas.getContext('2d')!;
  }
  return maskCtx!;
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

/**
 * Render mask paths to grayscale ImageData.
 * White = masked (visible), black = unmasked (hidden).
 */
export function renderMasks(
  masks: ClipMask[],
  width: number,
  height: number,
): ImageData {
  const enabled = masks.filter((m) => m.enabled && m.vertices.length >= 2);
  const ctx = ensureCanvas(width, height);

  // Background fill based on first mask mode
  const firstMode = enabled[0]?.mode ?? 'add';
  if (firstMode === 'add') {
    ctx.fillStyle = '#000000';
  } else {
    ctx.fillStyle = '#ffffff';
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillRect(0, 0, width, height);

  // Draw each mask
  for (const mask of enabled) {
    ctx.globalCompositeOperation = getCompositeOp(mask.mode);
    ctx.globalAlpha = mask.opacity;

    drawMaskPath(ctx, mask.vertices, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Apply feather (blur) if any mask has feather > 0.5
  const maxFeather = enabled.reduce((max, m) => Math.max(max, m.feather), 0);
  if (maxFeather > 0.5) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const tempCanvas = new OffscreenCanvas(width, height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${maxFeather}px)`;
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.filter = 'none';
  }

  // Handle inversion — if all masks share same inversion, apply globally
  const allInverted = enabled.length > 0 && enabled.every((m) => m.inverted);
  if (allInverted) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]!;
      data[i + 1] = 255 - data[i + 1]!;
      data[i + 2] = 255 - data[i + 2]!;
    }
    return imageData;
  }

  return ctx.getImageData(0, 0, width, height);
}
