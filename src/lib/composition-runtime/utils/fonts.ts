/**
 * Font loading utilities for compositions.
 * Uses native CSS Font Loading API and Canvas text measurement.
 *
 * IMPORTANT: loadFont() starts loading fonts asynchronously.
 * For guaranteed font availability, use loadFontAsync().
 */

import {
  loadFont as nativeLoadFont,
  loadFontAsync as nativeLoadFontAsync,
  loadFonts as nativeLoadFonts,
  loadFontsAsync as nativeLoadFontsAsync,
  FONT_WEIGHT_MAP as NATIVE_FONT_WEIGHT_MAP,
  AVAILABLE_FONTS as NATIVE_AVAILABLE_FONTS,
} from '@/lib/fonts';
import { measureText as nativeMeasureText } from '@/lib/fonts';

// Re-export font weight map for external use
export const FONT_WEIGHT_MAP = NATIVE_FONT_WEIGHT_MAP;

// Re-export available fonts
export const AVAILABLE_FONTS = NATIVE_AVAILABLE_FONTS;

/**
 * Load a Google Font for use in compositions.
 * This should be called before rendering text that uses the font.
 *
 * @param fontName - The font name (e.g., 'Inter', 'Roboto')
 * @returns The CSS font-family value to use in styles
 */
export function loadFont(fontName: string): string {
  return nativeLoadFont(fontName);
}

/**
 * Load a font and wait for it to be ready.
 *
 * @param fontName - The font name to load
 * @returns Promise resolving to the CSS font-family value
 */
export async function loadFontAsync(fontName: string): Promise<string> {
  return nativeLoadFontAsync(fontName);
}

/**
 * Load all fonts needed for a set of text items.
 * Call this at the composition level to ensure fonts are loaded before rendering.
 *
 * @param fontNames - Array of font names to load
 * @returns Array of CSS fontFamily values
 */
export function loadFonts(fontNames: string[]): string[] {
  return nativeLoadFonts(fontNames);
}

/**
 * Load all fonts and wait for them to be ready.
 *
 * @param fontNames - Array of font names to load
 * @returns Promise resolving to array of CSS fontFamily values
 */
export async function loadFontsAsync(fontNames: string[]): Promise<string[]> {
  return nativeLoadFontsAsync(fontNames);
}

/**
 * Measure text dimensions with the specified font properties.
 * Uses Canvas API for accurate measurement.
 *
 * @param text - The text to measure
 * @param options - Font options (fontFamily, fontSize, fontWeight, letterSpacing)
 * @returns Object with width and height in pixels
 */
export function measureTextDimensions(
  text: string,
  options: {
    fontFamily: string;
    fontSize: number;
    fontWeight?: string;
    letterSpacing?: number;
  }
): { width: number; height: number } {
  const { fontFamily, fontSize, fontWeight = 'normal', letterSpacing = 0 } = options;

  // Load font if not already loaded
  loadFont(fontFamily);

  try {
    return nativeMeasureText({
      text,
      fontFamily,
      fontSize,
      fontWeight: String(FONT_WEIGHT_MAP[fontWeight] ?? 400),
      letterSpacing: letterSpacing !== 0 ? `${letterSpacing}px` : undefined,
    });
  } catch (error) {
    // If measurement fails, return approximate dimensions
    console.warn(`Text measurement failed for "${fontFamily}":`, error);
    // Approximate: average character width is ~0.6x fontSize
    return {
      width: text.length * fontSize * 0.6,
      height: fontSize * 1.2,
    };
  }
}
