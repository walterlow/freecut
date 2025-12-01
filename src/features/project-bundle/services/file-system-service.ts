/**
 * File System Service
 *
 * Abstracts File System Access API operations for directory picking
 * and file writing during bundle import.
 */

export interface FileSystemServiceError {
  type: 'permission_denied' | 'user_cancelled' | 'write_failed' | 'unknown';
  message: string;
  originalError?: unknown;
}

/**
 * Request user to pick a directory via the File System Access API
 */
export async function pickDirectory(
  options?: DirectoryPickerOptions
): Promise<FileSystemDirectoryHandle> {
  try {
    return await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
      ...options,
    });
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        throw createError('user_cancelled', 'User cancelled directory selection');
      }
      if (error.name === 'NotAllowedError') {
        throw createError('permission_denied', 'Permission denied to access directory');
      }
    }
    throw createError('unknown', 'Failed to pick directory', error);
  }
}

/**
 * Create a subdirectory within a parent directory
 */
export async function getOrCreateSubdirectory(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parent.getDirectoryHandle(sanitizeDirectoryName(name), {
      create: true,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw createError('permission_denied', `Permission denied to create directory: ${name}`);
    }
    throw createError('unknown', `Failed to create directory: ${name}`, error);
  }
}

/**
 * Write a file to a directory and return the file handle
 */
export async function writeFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  content: Blob | ArrayBuffer | Uint8Array
): Promise<FileSystemFileHandle> {
  try {
    const fileHandle = await directory.getFileHandle(sanitizeFileName(fileName), {
      create: true,
    });

    const writable = await fileHandle.createWritable();
    try {
      if (content instanceof Blob) {
        await writable.write(content);
      } else if (content instanceof Uint8Array) {
        // Uint8Array can be written directly
        await writable.write(content as unknown as BufferSource);
      } else {
        // ArrayBuffer
        await writable.write(content as BufferSource);
      }
    } finally {
      await writable.close();
    }

    return fileHandle;
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        throw createError('permission_denied', `Permission denied to write file: ${fileName}`);
      }
      if (error.name === 'QuotaExceededError') {
        throw createError('write_failed', `Not enough disk space to write: ${fileName}`);
      }
    }
    throw createError('write_failed', `Failed to write file: ${fileName}`, error);
  }
}

/**
 * Check if a file exists in a directory
 */
export async function fileExists(
  directory: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique filename if the target already exists
 */
export async function getUniqueFileName(
  directory: FileSystemDirectoryHandle,
  fileName: string
): Promise<string> {
  if (!(await fileExists(directory, fileName))) {
    return fileName;
  }

  const ext = fileName.lastIndexOf('.');
  const baseName = ext > 0 ? fileName.substring(0, ext) : fileName;
  const extension = ext > 0 ? fileName.substring(ext) : '';

  let counter = 1;
  let newName: string;
  do {
    newName = `${baseName}_${counter}${extension}`;
    counter++;
  } while (await fileExists(directory, newName));

  return newName;
}

/**
 * Create a standardized error object
 */
function createError(
  type: FileSystemServiceError['type'],
  message: string,
  originalError?: unknown
): FileSystemServiceError {
  return { type, message, originalError };
}

/**
 * Sanitize a directory name for safe filesystem usage
 */
function sanitizeDirectoryName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100)
    .trim() || 'untitled';
}

/**
 * Sanitize a file name for safe filesystem usage
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .substring(0, 200)
    .trim() || 'unnamed';
}

/**
 * Grouped exports for convenient import
 */
export const fileSystemService = {
  pickDirectory,
  getOrCreateSubdirectory,
  writeFile,
  fileExists,
  getUniqueFileName,
};
