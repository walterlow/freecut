/**
 * Native text measurement utilities to replace @legacy-video/layout-utils
 *
 * Uses the Canvas API for accurate text measurement.
 */

import { FONT_WEIGHT_MAP, getFontFamily } from './font-loader';

// Shared canvas for text measurement
let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Get or create the measurement canvas
 */
function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureContext) {
    measureCanvas = document.createElement('canvas');
    measureContext = measureCanvas.getContext('2d')!;
  }
  return measureContext;
}

/**
 * Measure text dimensions with the specified font properties.
 *
 * @param options - Text measurement options
 * @returns Object with width and height in pixels
 */
export function measureText(options: {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string | number;
  letterSpacing?: string | number;
  lineHeight?: number;
  validateFontIsLoaded?: boolean;
}): { width: number; height: number } {
  const {
    text,
    fontFamily,
    fontSize,
    fontWeight = 'normal',
    letterSpacing,
    lineHeight,
  } = options;

  // Get the actual font family (handles loading)
  const resolvedFontFamily = getFontFamily(fontFamily);

  // Convert font weight to number
  const weightValue =
    typeof fontWeight === 'number'
      ? fontWeight
      : FONT_WEIGHT_MAP[fontWeight] ?? 400;

  // Build the font string
  const fontString = `${weightValue} ${fontSize}px ${resolvedFontFamily}`;

  const ctx = getMeasureContext();
  ctx.font = fontString;

  // Handle multi-line text
  const lines = text.split('\n');
  let maxWidth = 0;

  for (const line of lines) {
    let lineWidth: number;

    if (letterSpacing && letterSpacing !== 0) {
      // Canvas doesn't support letter-spacing, so we measure manually
      const spacing =
        typeof letterSpacing === 'string'
          ? parseFloat(letterSpacing)
          : letterSpacing;

      // Measure each character and add spacing
      lineWidth = 0;
      for (let i = 0; i < line.length; i++) {
        lineWidth += ctx.measureText(line[i]!).width;
        if (i < line.length - 1) {
          lineWidth += spacing;
        }
      }
    } else {
      lineWidth = ctx.measureText(line).width;
    }

    maxWidth = Math.max(maxWidth, lineWidth);
  }

  // Calculate height based on line count and line height
  const calculatedLineHeight = lineHeight ?? fontSize * 1.2;
  const totalHeight = lines.length * calculatedLineHeight;

  return {
    width: Math.ceil(maxWidth),
    height: Math.ceil(totalHeight),
  };
}

/**
 * Measure single-line text width
 *
 * @param text - The text to measure
 * @param fontFamily - The font family
 * @param fontSize - The font size in pixels
 * @param fontWeight - The font weight
 * @returns The width in pixels
 */
export function measureTextWidth(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: string | number = 'normal'
): number {
  return measureText({ text, fontFamily, fontSize, fontWeight }).width;
}

/**
 * Fit text within a max width by truncating with ellipsis
 *
 * @param text - The text to fit
 * @param maxWidth - Maximum width in pixels
 * @param fontFamily - The font family
 * @param fontSize - The font size in pixels
 * @param fontWeight - The font weight
 * @returns The truncated text (with ellipsis if needed)
 */
export function fitText(
  text: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: number,
  fontWeight: string | number = 'normal'
): string {
  const fullWidth = measureTextWidth(text, fontFamily, fontSize, fontWeight);
  if (fullWidth <= maxWidth) {
    return text;
  }

  const ellipsis = '...';
  const ellipsisWidth = measureTextWidth(ellipsis, fontFamily, fontSize, fontWeight);
  const availableWidth = maxWidth - ellipsisWidth;

  if (availableWidth <= 0) {
    return ellipsis;
  }

  // Binary search for the right length
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const truncated = text.slice(0, mid);
    const width = measureTextWidth(truncated, fontFamily, fontSize, fontWeight);

    if (width <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, low) + ellipsis;
}
