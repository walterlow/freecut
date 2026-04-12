export interface ObjectUrlSourceMetadata {
  mediaId?: string;
  storageType?: 'handle' | 'opfs';
  fileHandle?: FileSystemFileHandle;
  opfsPath?: string;
  fileSize?: number;
}

export interface DirectObjectUrlSourceMetadata {
  storageType: 'opfs';
  opfsPath: string;
  fileSize?: number;
}

interface ObjectUrlEntry {
  blob: Blob;
  metadata?: ObjectUrlSourceMetadata;
}

const entriesByUrl = new Map<string, ObjectUrlEntry>();

export function registerObjectUrl(
  url: string,
  blob: Blob,
  metadata?: ObjectUrlSourceMetadata,
): void {
  entriesByUrl.set(url, { blob, metadata });
}

export function getObjectUrlBlob(url: string): Blob | null {
  return entriesByUrl.get(url)?.blob ?? null;
}

export function getObjectUrlSourceMetadata(url: string): ObjectUrlSourceMetadata | null {
  return entriesByUrl.get(url)?.metadata ?? null;
}

export function getObjectUrlDirectFileMetadata(url: string): DirectObjectUrlSourceMetadata | null {
  const metadata = entriesByUrl.get(url)?.metadata;
  if (!metadata?.opfsPath) {
    return null;
  }

  return {
    storageType: 'opfs',
    opfsPath: metadata.opfsPath,
    fileSize: metadata.fileSize,
  };
}

export function unregisterObjectUrl(url: string): void {
  entriesByUrl.delete(url);
}

export function clearObjectUrlRegistry(): void {
  entriesByUrl.clear();
}
