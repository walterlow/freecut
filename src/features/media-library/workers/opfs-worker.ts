/**
 * OPFS Worker - Web Worker for high-performance file operations
 *
 * Uses the synchronous FileSystemSyncAccessHandle API for maximum performance.
 * This API is only available in Web Workers.
 *
 * File structure: media/{uuid}/{filename}
 */

export interface OPFSWorkerMessage {
  type: 'save' | 'get' | 'delete' | 'list' | 'processUpload' | 'saveUpload';
  payload: {
    path?: string;
    data?: ArrayBuffer;
    directory?: string;
    file?: File;
    fileSize?: number;
    targetPath?: string; // For saveUpload - direct path without hashing
  };
}

export interface OPFSWorkerResponse {
  success: boolean;
  data?: ArrayBuffer | string[];
  hash?: string;
  opfsPath?: string;
  bytesWritten?: number;
  error?: string;
}

export interface UploadProgress {
  type: 'progress';
  bytesWritten: number;
  percent: number;
}

let opfsRoot: FileSystemDirectoryHandle | null = null;

/**
 * Initialize OPFS root directory
 */
async function initOPFS(): Promise<FileSystemDirectoryHandle> {
  if (!opfsRoot) {
    opfsRoot = await navigator.storage.getDirectory();
  }
  return opfsRoot;
}

/**
 * Navigate to a file's directory, creating directories as needed
 */
async function navigateToDirectory(
  path: string
): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> {
  const root = await initOPFS();
  const parts = path.split('/').filter((p) => p);

  if (parts.length === 0) {
    throw new Error('Invalid path');
  }

  let dir = root;

  // Navigate through directories (all parts except the last which is the filename)
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }

  const fileName = parts[parts.length - 1];
  if (!fileName) {
    throw new Error('Invalid path: missing filename');
  }

  return { dir, fileName };
}

/**
 * Write a file to OPFS using synchronous access handle
 */
async function saveFile(path: string, data: ArrayBuffer): Promise<void> {
  const { dir, fileName } = await navigateToDirectory(path);

  // Get file handle (create if doesn't exist)
  const fileHandle = await dir.getFileHandle(fileName, { create: true });

  // Use synchronous API for maximum performance
  const syncHandle = await fileHandle.createSyncAccessHandle();

  try {
    const buffer = new Uint8Array(data);

    // Truncate file to 0 (clear existing content)
    syncHandle.truncate(0);

    // Write data
    syncHandle.write(buffer, { at: 0 });

    // Ensure data is persisted to disk
    syncHandle.flush();
  } finally {
    // Always close the handle
    syncHandle.close();
  }
}

/**
 * Read a file from OPFS
 */
async function getFile(path: string): Promise<ArrayBuffer> {
  const { dir, fileName } = await navigateToDirectory(path);

  try {
    const fileHandle = await dir.getFileHandle(fileName);
    const syncHandle = await fileHandle.createSyncAccessHandle();

    try {
      const size = syncHandle.getSize();
      const buffer = new ArrayBuffer(size);
      syncHandle.read(buffer, { at: 0 });
      return buffer;
    } finally {
      syncHandle.close();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      throw new Error(`File not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Delete a file from OPFS
 */
async function deleteFile(path: string): Promise<void> {
  const { dir, fileName } = await navigateToDirectory(path);

  try {
    await dir.removeEntry(fileName);
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      // File doesn't exist, consider it deleted
      return;
    }
    throw error;
  }
}

/**
 * List all files in a directory
 */
async function listFiles(directory: string): Promise<string[]> {
  const root = await initOPFS();
  const parts = directory.split('/').filter((p) => p);

  let dir = root;

  // Navigate to the target directory
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') {
        // Directory doesn't exist, return empty list
        return [];
      }
      throw error;
    }
  }

  // List all files in the directory
  const files: string[] = [];

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      files.push(name);
    }
  }

  return files;
}

/**
 * Generate content-addressable path from hash
 */
function getContentPath(contentHash: string): string {
  const shard1 = contentHash.substring(0, 2);
  const shard2 = contentHash.substring(2, 4);
  return `content/${shard1}/${shard2}/${contentHash}/data`;
}

/**
 * Convert ArrayBuffer to hex string (for hash)
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Process upload: stream file, compute hash, and save to content-addressable storage
 *
 * This function handles the entire upload pipeline off the main thread:
 * 1. Streams the file in chunks using file.stream()
 * 2. Writes chunks to a temporary OPFS location
 * 3. Accumulates chunks for SHA-256 hash computation
 * 4. Computes hash and renames to content-addressable path
 *
 * @param file - The File object to process
 * @param onProgress - Progress callback for UI updates
 * @returns Object with hash and bytesWritten
 */
async function processUploadStreaming(
  file: File,
  onProgress?: (progress: { bytesWritten: number; percent: number }) => void
): Promise<{ hash: string; bytesWritten: number; opfsPath: string }> {
  // Create temp directory path
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const tempPath = `content/temp/${tempId}/data`;

  const { dir, fileName } = await navigateToDirectory(tempPath);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const syncHandle = await fileHandle.createSyncAccessHandle();

  // Stream file and accumulate chunks for hashing
  const stream = file.stream();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytesWritten = 0;

  try {
    syncHandle.truncate(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Write chunk to OPFS
      syncHandle.write(value, { at: bytesWritten });
      bytesWritten += value.byteLength;

      // Accumulate for hash computation
      chunks.push(value);

      // Report progress
      onProgress?.({
        bytesWritten,
        percent: (bytesWritten / file.size) * 100,
      });
    }

    syncHandle.flush();
  } finally {
    syncHandle.close();
  }

  // Compute SHA-256 hash from accumulated chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hash = bufferToHex(hashBuffer);

  // Generate final content-addressable path
  const finalPath = getContentPath(hash);

  // Read temp file and write to final location
  const { dir: finalDir, fileName: finalFileName } =
    await navigateToDirectory(finalPath);
  const finalFileHandle = await finalDir.getFileHandle(finalFileName, {
    create: true,
  });
  const finalSyncHandle = await finalFileHandle.createSyncAccessHandle();

  try {
    finalSyncHandle.truncate(0);
    finalSyncHandle.write(combined, { at: 0 });
    finalSyncHandle.flush();
  } finally {
    finalSyncHandle.close();
  }

  // Clean up temp file
  try {
    const { dir: tempDir, fileName: tempFileName } =
      await navigateToDirectory(tempPath);
    await tempDir.removeEntry(tempFileName);
  } catch {
    // Ignore cleanup errors
  }

  return { hash, bytesWritten, opfsPath: finalPath };
}

/**
 * Save upload: stream file directly to target path WITHOUT hashing
 *
 * Used when file size is unique (no potential duplicates), skipping hash computation.
 * Much faster for large files since we don't accumulate chunks for hashing.
 *
 * @param file - The File object to process
 * @param targetPath - Direct OPFS path to save to
 * @param onProgress - Progress callback for UI updates
 * @returns Object with bytesWritten and opfsPath
 */
async function saveUploadStreaming(
  file: File,
  targetPath: string,
  onProgress?: (progress: { bytesWritten: number; percent: number }) => void
): Promise<{ bytesWritten: number; opfsPath: string }> {
  const { dir, fileName } = await navigateToDirectory(targetPath);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const syncHandle = await fileHandle.createSyncAccessHandle();

  const stream = file.stream();
  const reader = stream.getReader();
  let bytesWritten = 0;

  try {
    syncHandle.truncate(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Write chunk directly to final location
      syncHandle.write(value, { at: bytesWritten });
      bytesWritten += value.byteLength;

      // Report progress
      onProgress?.({
        bytesWritten,
        percent: (bytesWritten / file.size) * 100,
      });
    }

    syncHandle.flush();
  } finally {
    syncHandle.close();
  }

  return { bytesWritten, opfsPath: targetPath };
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<OPFSWorkerMessage>) => {
  const { type, payload } = event.data;
  const port = event.ports[0];

  if (!port) {
    console.error('No message port provided');
    return;
  }

  let response: OPFSWorkerResponse;

  try {
    switch (type) {
      case 'save':
        if (!payload.path || !payload.data) {
          throw new Error('Missing path or data for save operation');
        }
        await saveFile(payload.path, payload.data);
        response = { success: true };
        break;

      case 'get': {
        if (!payload.path) {
          throw new Error('Missing path for get operation');
        }
        const data = await getFile(payload.path);
        response = { success: true, data };
        break;
      }

      case 'delete':
        if (!payload.path) {
          throw new Error('Missing path for delete operation');
        }
        await deleteFile(payload.path);
        response = { success: true };
        break;

      case 'list': {
        if (!payload.directory) {
          throw new Error('Missing directory for list operation');
        }
        const files = await listFiles(payload.directory);
        response = { success: true, data: files };
        break;
      }

      case 'processUpload': {
        if (!payload.file) {
          throw new Error('Missing file for processUpload operation');
        }
        const uploadResult = await processUploadStreaming(
          payload.file,
          (progress) => {
            // Send progress updates back through the port
            port.postMessage({ type: 'progress', ...progress } as UploadProgress);
          }
        );
        response = {
          success: true,
          hash: uploadResult.hash,
          bytesWritten: uploadResult.bytesWritten,
          opfsPath: uploadResult.opfsPath,
        };
        break;
      }

      case 'saveUpload': {
        if (!payload.file || !payload.targetPath) {
          throw new Error('Missing file or targetPath for saveUpload operation');
        }
        const saveResult = await saveUploadStreaming(
          payload.file,
          payload.targetPath,
          (progress) => {
            port.postMessage({ type: 'progress', ...progress } as UploadProgress);
          }
        );
        response = {
          success: true,
          bytesWritten: saveResult.bytesWritten,
          opfsPath: saveResult.opfsPath,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${type}`);
    }
  } catch (error) {
    response = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  port.postMessage(response);
};

// Export for TypeScript
export {};
