import type { ClipMask } from '@/types/masks';
import { renderMasks } from '@/infrastructure/gpu/masks';

export function shouldUseComplexClipMask(masks: ClipMask[]): boolean {
  return masks.some((m) =>
    m.feather > 0.5 || m.opacity < 0.99 || m.inverted || m.mode !== 'add'
  );
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
  const maskWidth = Math.max(1, Math.round(width));
  const maskHeight = Math.max(1, Math.round(height));

  if (
    maskWidth <= 0
    || maskHeight <= 0
    || typeof OffscreenCanvas === 'undefined'
    || typeof document === 'undefined'
  ) {
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = renderMasks(masks, maskWidth, maskHeight);
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = maskWidth;
  canvas.height = maskHeight;

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  ctx.putImageData(remapMaskImageDataToAlpha(imageData), 0, 0);
  return canvas.toDataURL('image/png');
}
