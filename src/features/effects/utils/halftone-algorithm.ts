import type { HalftoneEffect, ItemEffect } from '@/types/effects';

export interface HalftoneOptions {
  dotSize: number;
  spacing: number;
  angle: number;
  intensity: number;
  backgroundColor: string;
  dotColor: string;
}

/**
 * Calculate luminance from RGB using ITU-R BT.709 coefficients.
 * Returns a value from 0 (black) to 1 (white).
 */
function getLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Render halftone effect to output canvas.
 *
 * Creates a classic print-style dot pattern where dot size varies
 * based on the luminance of the underlying image - darker areas
 * produce larger dots, lighter areas produce smaller dots.
 *
 * The algorithm works by:
 * 1. Creating a rotated grid of sample points
 * 2. For each grid point, sample the source image luminance
 * 3. Draw a dot at the ROTATED position (within canvas bounds)
 *
 * @param sourceCanvas - Canvas containing the source image data
 * @param outputCanvas - Canvas to render the halftone result to
 * @param options - Halftone configuration options
 */
export function renderHalftone(
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  outputCanvas: HTMLCanvasElement | OffscreenCanvas,
  options: HalftoneOptions
): void {
  const { dotSize, spacing, angle, intensity, backgroundColor, dotColor } = options;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  // Get source image data
  const sourceCtx = sourceCanvas.getContext('2d');
  const outputCtx = outputCanvas.getContext('2d');
  if (!sourceCtx || !outputCtx) return;

  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Set output canvas size
  outputCanvas.width = width;
  outputCanvas.height = height;

  // Fill background
  outputCtx.fillStyle = backgroundColor;
  outputCtx.fillRect(0, 0, width, height);

  // Convert angle to radians
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Set dot color
  outputCtx.fillStyle = dotColor;

  // Center point for rotation
  const centerX = width / 2;
  const centerY = height / 2;

  // Calculate grid bounds in rotated space to cover entire canvas
  // We need to iterate in the rotated coordinate system
  const diagonal = Math.sqrt(width * width + height * height);
  const gridStart = -diagonal / 2;
  const gridEnd = diagonal / 2;

  // Iterate over grid points in the ROTATED coordinate system
  for (let ry = gridStart; ry < gridEnd; ry += spacing) {
    for (let rx = gridStart; rx < gridEnd; rx += spacing) {
      // Transform from rotated grid space back to canvas space
      // This gives us where the dot should be drawn
      const drawX = cos * rx - sin * ry + centerX;
      const drawY = sin * rx + cos * ry + centerY;

      // Skip if dot center is outside canvas bounds (with margin for dot radius)
      const maxRadius = dotSize / 2;
      if (drawX < -maxRadius || drawX >= width + maxRadius ||
          drawY < -maxRadius || drawY >= height + maxRadius) {
        continue;
      }

      // Sample position is the same as draw position
      const sampleX = Math.round(drawX);
      const sampleY = Math.round(drawY);

      // Check sample bounds
      if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
        continue;
      }

      // Get pixel luminance at sample position
      const pixelIndex = (sampleY * width + sampleX) * 4;
      const r = pixels[pixelIndex]!;
      const g = pixels[pixelIndex + 1]!;
      const b = pixels[pixelIndex + 2]!;

      const luminance = getLuminance(r, g, b);

      // Darker = larger dot (invert luminance)
      const darkness = 1 - luminance;
      const radius = darkness * maxRadius * intensity;

      if (radius > 0.5) {
        // Draw dot at the calculated position
        outputCtx.beginPath();
        outputCtx.arc(drawX, drawY, radius, 0, Math.PI * 2);
        outputCtx.fill();
      }
    }
  }
}

/**
 * Extract halftone effect from effects array.
 *
 * @param effects - Array of item effects
 * @returns The halftone effect with its ID, or null if not found
 */
export function getHalftoneEffect(
  effects: ItemEffect[]
): (HalftoneEffect & { id: string }) | null {
  const effect = effects.find(
    (e) => e.enabled && e.effect.type === 'canvas-effect' && e.effect.variant === 'halftone'
  );
  if (!effect) return null;
  return { id: effect.id, ...(effect.effect as HalftoneEffect) };
}

/**
 * Create default halftone effect options.
 */
export function createDefaultHalftoneEffect(): HalftoneEffect {
  return {
    type: 'canvas-effect',
    variant: 'halftone',
    dotSize: 6,
    spacing: 8,
    angle: 45,
    intensity: 1,
    backgroundColor: '#ffffff',
    dotColor: '#000000',
  };
}
