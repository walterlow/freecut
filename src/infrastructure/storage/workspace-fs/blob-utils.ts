/**
 * Cross-environment Blob helpers.
 *
 * jsdom's Blob (used in tests) omits `arrayBuffer()` in some versions;
 * Response-based conversion works everywhere jsdom supports fetch.
 */

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  return new Response(blob).arrayBuffer()
}
