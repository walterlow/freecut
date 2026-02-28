/**
 * Font loading utilities for compositions.
 * Uses native CSS Font Loading API and Canvas text measurement.
 *
 * loadFont() starts loading fonts asynchronously.
 */

import {
  loadFont as nativeLoadFont,
  loadFonts as nativeLoadFonts,
  FONT_WEIGHT_MAP as NATIVE_FONT_WEIGHT_MAP,
} from '@/shared/typography/fonts';

// Re-export font weight map for external use
export const FONT_WEIGHT_MAP = NATIVE_FONT_WEIGHT_MAP;

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
 * Load all fonts needed for a set of text items.
 * Call this at the composition level to ensure fonts are loaded before rendering.
 *
 * @param fontNames - Array of font names to load
 * @returns Array of CSS fontFamily values
 */
export function loadFonts(fontNames: string[]): string[] {
  return nativeLoadFonts(fontNames);
}

