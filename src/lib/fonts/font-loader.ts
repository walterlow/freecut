/**
 * Native font loading utilities to replace @legacy-video/google-fonts
 *
 * Uses the CSS Font Loading API and Google Fonts CSS API.
 */

// Font weight CSS value mapping
export const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// Cache for loaded fonts
const loadedFontFamilies = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string>>();

// Google Fonts configuration
interface FontConfig {
  family: string;
  weights: number[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

const FONT_CONFIGS: Record<string, FontConfig> = {
  Inter: { family: 'Inter', weights: [400, 500, 600, 700] },
  Roboto: { family: 'Roboto', weights: [400, 500, 700] },
  'Open Sans': { family: 'Open Sans', weights: [400, 500, 600, 700] },
  Lato: { family: 'Lato', weights: [400, 700] },
  Montserrat: { family: 'Montserrat', weights: [400, 500, 600, 700] },
  Oswald: { family: 'Oswald', weights: [400, 500, 600, 700] },
  Poppins: { family: 'Poppins', weights: [400, 500, 600, 700] },
  'Playfair Display': { family: 'Playfair Display', weights: [400, 500, 600, 700] },
  'Bebas Neue': { family: 'Bebas Neue', weights: [400] },
  Anton: { family: 'Anton', weights: [400] },
};

// Available fonts
export const AVAILABLE_FONTS = Object.keys(FONT_CONFIGS);

/**
 * Build Google Fonts URL for a font
 */
function buildGoogleFontsUrl(config: FontConfig): string {
  const family = config.family.replace(/ /g, '+');
  const weights = config.weights.join(';');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&display=swap`;
}

/**
 * Load a font from Google Fonts
 */
async function loadGoogleFont(fontName: string): Promise<string> {
  const config = FONT_CONFIGS[fontName];
  if (!config) {
    console.warn(`Font "${fontName}" not configured, using system fallback`);
    return fontName;
  }

  // Check if already loading
  const existingPromise = loadingPromises.get(fontName);
  if (existingPromise) {
    return existingPromise;
  }

  // Check if already loaded
  const cached = loadedFontFamilies.get(fontName);
  if (cached) {
    return cached;
  }

  const loadPromise = (async () => {
    try {
      // Check if link already exists
      const existingLink = document.querySelector(`link[data-font="${fontName}"]`);
      if (!existingLink) {
        // Create link element for Google Fonts
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = buildGoogleFontsUrl(config);
        link.setAttribute('data-font', fontName);
        document.head.appendChild(link);

        // Wait for stylesheet to load
        await new Promise<void>((resolve, reject) => {
          link.onload = () => resolve();
          link.onerror = () => reject(new Error(`Failed to load font: ${fontName}`));
        });
      }

      // Wait for font to be ready using Font Loading API
      if (document.fonts) {
        await document.fonts.ready;

        // Check if font is actually loaded
        const fontFace = `400 16px "${config.family}"`;
        const loaded = document.fonts.check(fontFace);

        if (!loaded) {
          // Try to force load
          await document.fonts.load(fontFace);
        }
      }

      // Cache and return the font family
      const fontFamily = `"${config.family}", sans-serif`;
      loadedFontFamilies.set(fontName, fontFamily);
      return fontFamily;
    } catch (error) {
      console.warn(`Failed to load font "${fontName}":`, error);
      return fontName;
    } finally {
      loadingPromises.delete(fontName);
    }
  })();

  loadingPromises.set(fontName, loadPromise);
  return loadPromise;
}

/**
 * Load a Google Font for use in compositions.
 * This should be called before rendering text that uses the font.
 *
 * @param fontName - The font name (e.g., 'Inter', 'Roboto')
 * @returns The CSS font-family value to use in styles
 */
export function loadFont(fontName: string): string {
  // Check if font is already loaded and return cached fontFamily
  const cached = loadedFontFamilies.get(fontName);
  if (cached) {
    return cached;
  }

  // Start loading in background (fire and forget for sync API compatibility)
  loadGoogleFont(fontName);

  // Return immediately with font-family string
  // The font will be available when it finishes loading
  const config = FONT_CONFIGS[fontName];
  if (config) {
    return `"${config.family}", sans-serif`;
  }

  return fontName;
}

/**
 * Load a font and wait for it to be ready
 *
 * @param fontName - The font name to load
 * @returns Promise resolving to the CSS font-family value
 */
export async function loadFontAsync(fontName: string): Promise<string> {
  return loadGoogleFont(fontName);
}

/**
 * Load all fonts needed for a set of text items.
 *
 * @param fontNames - Array of font names to load
 * @returns Array of CSS fontFamily values
 */
export function loadFonts(fontNames: string[]): string[] {
  const uniqueFonts = [...new Set(fontNames)];
  return uniqueFonts.map(loadFont);
}

/**
 * Load all fonts and wait for them to be ready
 *
 * @param fontNames - Array of font names to load
 * @returns Promise resolving to array of CSS fontFamily values
 */
export async function loadFontsAsync(fontNames: string[]): Promise<string[]> {
  const uniqueFonts = [...new Set(fontNames)];
  return Promise.all(uniqueFonts.map(loadFontAsync));
}

/**
 * Check if a font is loaded
 *
 * @param fontName - The font name to check
 * @returns Whether the font is loaded
 */
export function isFontLoaded(fontName: string): boolean {
  return loadedFontFamilies.has(fontName);
}

/**
 * Get the CSS font-family for a font (returns fallback if not loaded)
 *
 * @param fontName - The font name
 * @returns The CSS font-family value
 */
export function getFontFamily(fontName: string): string {
  const cached = loadedFontFamilies.get(fontName);
  if (cached) {
    return cached;
  }

  const config = FONT_CONFIGS[fontName];
  if (config) {
    return `"${config.family}", sans-serif`;
  }

  return fontName;
}
