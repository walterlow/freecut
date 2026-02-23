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
 * 1) content hash
 * 2) OPFS path (content-addressable)
 * 3) file fingerprint fallback for handle-based media
 */
export function getSharedProxyKey(media: ProxyKeyMedia): string {
  if (media.contentHash) {
    return `h-${media.contentHash}`;
  }

  if (media.storageType === 'opfs' && media.opfsPath) {
    return `o-${fnv1a32(media.opfsPath)}-${media.fileSize}`;
  }

  const fingerprint = [
    media.fileName,
    media.fileSize,
    media.mimeType,
    media.fileLastModified ?? 0,
    media.width,
    media.height,
  ].join('|');

  return `f-${fnv1a32(fingerprint)}-${media.fileSize}-${media.fileLastModified ?? 0}`;
}
