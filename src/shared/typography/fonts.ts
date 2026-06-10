/**
 * Native font utilities
 *
 * Replaces @legacy-video/google-fonts and @legacy-video/layout-utils with native implementations.
 */

export { loadFont, loadFonts, ensureFontsLoaded, FONT_WEIGHT_MAP } from './font-loader'

export { FONT_CATALOG } from './font-catalog'

export type { FontCatalogEntry } from './font-catalog'

export { getGoogleFontsCatalog } from './google-font-catalog'
