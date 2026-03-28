import { getMediaType, getMimeType, validateMediaFile } from './validation';

export interface ExtractedMediaFileEntry {
  handle: FileSystemFileHandle;
  file: File;
  mediaType: 'video' | 'audio' | 'image' | 'unknown';
}

export interface ExtractedMediaFileDropResult {
  supported: boolean;
  entries: ExtractedMediaFileEntry[];
  errors: string[];
}

export function supportsFileSystemDragDrop(dataTransfer: DataTransfer): boolean {
  const firstItem = dataTransfer.items[0];
  return !!firstItem && 'getAsFileSystemHandle' in firstItem;
}

export async function extractValidMediaFileEntriesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<ExtractedMediaFileDropResult> {
  if (!supportsFileSystemDragDrop(dataTransfer)) {
    return {
      supported: false,
      entries: [],
      errors: [],
    };
  }

  const items = Array.from(dataTransfer.items);
  const handlePromises: Promise<FileSystemHandle | null>[] = [];
  for (const item of items) {
    if ('getAsFileSystemHandle' in item) {
      handlePromises.push(item.getAsFileSystemHandle());
    }
  }

  const rawHandles = await Promise.all(handlePromises);
  const entries: ExtractedMediaFileEntry[] = [];
  const errors: string[] = [];

  for (const handle of rawHandles) {
    if (handle?.kind !== 'file') {
      continue;
    }

    const fileHandle = handle as FileSystemFileHandle;
    try {
      const file = await fileHandle.getFile();
      const validation = validateMediaFile(file);
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`);
        continue;
      }

      entries.push({
        handle: fileHandle,
        file,
        mediaType: getMediaType(getMimeType(file)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read file';
      errors.push(`Unknown file: ${message}`);
    }
  }

  return {
    supported: true,
    entries,
    errors,
  };
}
