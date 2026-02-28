import { FONT_CATALOG, type FontCatalogEntry } from './font-catalog';

let cachedGoogleFontCatalog: readonly FontCatalogEntry[] | null = null;

export async function getGoogleFontsCatalog(): Promise<readonly FontCatalogEntry[]> {
  if (cachedGoogleFontCatalog) {
    return cachedGoogleFontCatalog;
  }

  const catalog = [...FONT_CATALOG];
  cachedGoogleFontCatalog = catalog;
  return catalog;
}
