/**
 * Content hashing utilities for media deduplication
 *
 * Uses SHA-256 to generate content-addressable hashes for media files.
 * This enables deduplication - same file uploaded multiple times is stored once.
 */

/**
 * Compute SHA-256 hash from an ArrayBuffer
 *
 * @param buffer - The buffer to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export async function computeContentHashFromBuffer(
  buffer: ArrayBuffer
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
