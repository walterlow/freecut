/**
 * Check if a URL or filename indicates a GIF file
 */
export function isGifUrl(url: string): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.gif') || lowerUrl.includes('.gif');
}

/**
 * Check if a URL or filename indicates a WebP file
 */
export function isWebpUrl(url: string): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.webp') || lowerUrl.includes('.webp');
}
