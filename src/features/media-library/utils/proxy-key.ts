import type { MediaMetadata } from '@/types/storage';

type ProxyKeyMedia = Pick<
  MediaMetadata,
  | 'id'
  | 'storageType'
  | 'contentHash'
  | 'opfsPath'
  | 'fileName'
  | 'fileSize'
  | 'mimeType'
  | 'fileLastModified'
  | 'width'
  | 'height'
>;

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a stable proxy identity key for shared proxy files.
 * Uses strongest source identity available:
 * 1) content hash (SHA-256 hex, 64 chars)
 * 2) OPFS path hash + size
 * 3) file fingerprint fallback for handle-based media
 *
 * The three formats are distinguishable by shape (hex-length vs dashed
 * fingerprint), so no source-type tag is needed in the key. Keeping the
 * key tag-free means on-disk folder names under `content/proxies/` read
 * as the underlying fingerprint rather than `f-…` / `h-…` / `o-…`.
 */
export function getSharedProxyKey(media: ProxyKeyMedia): string {
  if (media.contentHash) {
    return media.contentHash;
  }

  if (media.storageType === 'opfs' && media.opfsPath) {
    return `${fnv1a32(media.opfsPath)}-${media.fileSize}`;
  }

  const fingerprint = [
    media.fileName,
    media.fileSize,
    media.mimeType,
    media.fileLastModified ?? 0,
    media.width,
    media.height,
  ].join('|');

  return `${fnv1a32(fingerprint)}-${media.fileSize}-${media.fileLastModified ?? 0}`;
}
