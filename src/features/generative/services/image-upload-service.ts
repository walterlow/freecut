import { createLogger } from '@/shared/logging/logger';

const log = createLogger('ImageUploadService');

/**
 * Convert a local Blob to a publicly accessible URL that evolink.ai can fetch.
 *
 * Strategy:
 * 1. Convert to base64 data URI — simplest path, works if the API accepts it.
 * 2. If the API rejects data URIs, a Vercel API route (/api/upload-temp) can be
 *    added later. This function abstracts the mechanism from callers.
 */
export async function getPublicImageUrl(blob: Blob): Promise<string> {
  return blobToDataUri(blob);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        log.debug('Converted blob to data URI', { size: blob.size, type: blob.type });
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return a string'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * For generated images that already have HTTP URLs, return as-is.
 * For local file blobs, convert to a public URL.
 */
export async function ensurePublicUrl(
  source: { type: 'file'; blob: Blob } | { type: 'generated'; url: string },
): Promise<string> {
  if (source.type === 'generated') return source.url;
  return getPublicImageUrl(source.blob);
}
