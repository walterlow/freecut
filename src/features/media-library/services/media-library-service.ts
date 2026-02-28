import type { MediaMetadata, ThumbnailData } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaLibraryService');
import {
  getAllMedia as getAllMediaDB,
  getMedia as getMediaDB,
  createMedia as createMediaDB,
  updateMedia as updateMediaDB,
  deleteMedia as deleteMediaDB,
  saveThumbnail as saveThumbnailDB,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
  // v3: Content-addressable storage
  incrementContentRef,
  decrementContentRef,
  deleteContent,
  // v3: Project-media associations
  associateMediaWithProject,
  removeMediaFromProject as removeMediaFromProjectDB,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject as getMediaForProjectDB,
} from '@/infrastructure/storage/indexeddb';
import { gifFrameCache } from '@/features/media-library/deps/timeline-services';
import { opfsService } from './opfs-service';
import { proxyService } from './proxy-service';
import { validateMediaFile, getMimeType } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';
import { mediaProcessorService } from './media-processor-service';
/**
 * Check and request permission for a file handle
 * @returns true if permission granted, false otherwise
 */
async function ensureFileHandlePermission(
  handle: FileSystemFileHandle
): Promise<boolean> {
  try {
    // Check current permission state
    const permission = await handle.queryPermission({ mode: 'read' });
    if (permission === 'granted') {
      return true;
    }

    // Request permission if not granted
    const newPermission = await handle.requestPermission({ mode: 'read' });
    return newPermission === 'granted';
  } catch (error) {
    logger.error('Failed to get file handle permission:', error);
    return false;
  }
}

/**
 * Error thrown when file handle permission is denied or file is missing
 */
export class FileAccessError extends Error {
  constructor(
    message: string,
    public readonly type: 'permission_denied' | 'file_missing' | 'unknown'
  ) {
    super(message);
    this.name = 'FileAccessError';
  }
}

/**
 * Media Library Service - Coordinates OPFS + IndexedDB + metadata extraction
 *
 * Includes in-memory thumbnail URL cache to prevent flicker on re-renders.
 *
 * Provides atomic operations for media management, ensuring OPFS and IndexedDB
 * stay in sync.
 */
class MediaLibraryService {
  /** In-memory cache for thumbnail blob URLs to prevent flicker on re-renders */
  private thumbnailUrlCache = new Map<string, string>();

  /**
   * Get all media items from IndexedDB
   */
  async getAllMedia(): Promise<MediaMetadata[]> {
    return getAllMediaDB();
  }

  /**
   * Get a single media item by ID
   */
  async getMedia(id: string): Promise<MediaMetadata | null> {
    const media = await getMediaDB(id);
    return media || null;
  }

  /**
   * Import media using FileSystemFileHandle (instant, no copy)
   *
   * This is the preferred method for local-first experience. The file stays
   * on the user's disk and is read on-demand. No copying or uploading.
   *
   * Duplicate detection: If a file with the same name and size already exists
   * in the project, returns the existing media with `isDuplicate: true`.
   *
   * @param handle - FileSystemFileHandle from showOpenFilePicker
   * @param projectId - The project to associate the media with
   * @returns MediaMetadata with optional isDuplicate flag
   */
  async importMediaWithHandle(
    handle: FileSystemFileHandle,
    projectId: string
  ): Promise<MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }> {
    // Stage 1: Get file from handle (instant)
    const hasPermission = await ensureFileHandlePermission(handle);
    if (!hasPermission) {
      throw new FileAccessError(
        'Permission denied to access file',
        'permission_denied'
      );
    }

    const file = await handle.getFile();

    // Stage 2: Validation
    const validationResult = validateMediaFile(file);
    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    // Stage 3: Check for duplicates (by fileName + fileSize)
    const projectMedia = await getMediaForProjectDB(projectId);

    const existingMedia = projectMedia.find(
      (m) => m.fileName === file.name && m.fileSize === file.size
    );

    if (existingMedia) {
      // File already exists in project - return existing with duplicate flag
      return { ...existingMedia, isDuplicate: true };
    }

    // Stage 4: Process media in worker (metadata + thumbnail in one pass, off main thread)
    const resolvedMimeType = getMimeType(file);
    const id = crypto.randomUUID();
    let thumbnailId: string | undefined;

    const { metadata, thumbnail } = await mediaProcessorService.processMedia(
      file,
      resolvedMimeType,
      { thumbnailTimestamp: 1 }
    );

    // Stage 5: Save thumbnail if generated
    if (thumbnail) {
      try {
        thumbnailId = crypto.randomUUID();
        const thumbnailData: ThumbnailData = {
          id: thumbnailId,
          mediaId: id,
          blob: thumbnail,
          timestamp: 1,
          width: 320,
          height: 180,
        };
        await saveThumbnailDB(thumbnailData);
      } catch (error) {
        logger.warn('Failed to save thumbnail:', error);
        thumbnailId = undefined;
      }
    }

    // Check for unsupported audio codec (included in metadata from worker)
    const codecCheck = mediaProcessorService.hasUnsupportedAudioCodec(metadata);

    // Stage 6: Save metadata to IndexedDB with file handle
    const mediaMetadata: MediaMetadata = {
      id,
      storageType: 'handle',
      fileHandle: handle,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      mimeType: resolvedMimeType,
      duration: 'duration' in metadata ? metadata.duration : 0,
      width: 'width' in metadata ? metadata.width : 0,
      height: 'height' in metadata ? metadata.height : 0,
      fps: metadata.type === 'video' ? metadata.fps : 30,
      codec: metadata.type === 'video'
        ? metadata.codec
        : metadata.type === 'audio'
          ? (metadata.codec || 'unknown')
          : 'unknown',
      bitrate: 'bitrate' in metadata ? (metadata.bitrate ?? 0) : 0,
      audioCodec: metadata.type === 'video' ? metadata.audioCodec : undefined,
      audioCodecSupported: metadata.type === 'video' ? metadata.audioCodecSupported : true,
      thumbnailId,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await createMediaDB(mediaMetadata);

    // Stage 7: Associate with project
    await associateMediaWithProject(projectId, id);

    // Pre-extract GIF frames in background
    if (resolvedMimeType === 'image/gif') {
      const blobUrl = URL.createObjectURL(file);
      void gifFrameCache.getGifFrames(id, blobUrl)
        .catch((err) => logger.warn('Failed to pre-extract GIF frames:', err))
        .finally(() => URL.revokeObjectURL(blobUrl));
    }

    return {
      ...mediaMetadata,
      hasUnsupportedCodec: codecCheck.unsupported,
    };
  }

  /**
   * Import multiple files using FileSystemFileHandles (instant, no copy)
   */
  async importMediaBatchWithHandles(
    handles: FileSystemFileHandle[],
    projectId: string,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<MediaMetadata[]> {
    const results: MediaMetadata[] = [];
    const errors: { file: string; error: string }[] = [];

    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i];
      if (!handle) continue;

      const file = await handle.getFile().catch(() => null);
      const fileName = file?.name ?? handle.name;
      onProgress?.(i + 1, handles.length, fileName);

      try {
        const metadata = await this.importMediaWithHandle(handle, projectId);
        results.push(metadata);
      } catch (error) {
        errors.push({
          file: fileName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      logger.warn('Some files failed to import:', errors);
    }

    return results;
  }

  /**
   * Delete media from a project with reference counting
   *
   * Removes the media association from the project. If no other projects
   * use this media, the metadata is deleted.
   *
   * For OPFS storage: Also deletes the file if no more references.
   * For handle storage: Just removes metadata (file stays on user's disk).
   *
   * @param projectId - The project to remove media from
   * @param mediaId - The media to remove
   */
  async deleteMediaFromProject(
    projectId: string,
    mediaId: string
  ): Promise<void> {
    // Get media metadata
    const media = await getMediaDB(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Remove project-media association
    await removeMediaFromProjectDB(projectId, mediaId);

    // Check if any other projects still use this media
    const remainingProjects = await getProjectsUsingMedia(mediaId);

    if (remainingProjects.length === 0) {
      // No other projects use this media - safe to fully delete metadata

      // Delete media metadata
      await deleteMediaDB(mediaId);

      // Delete thumbnails (clear cache first)
      this.clearThumbnailCache(mediaId);
      try {
        await deleteThumbnailsByMediaId(mediaId);
      } catch (error) {
        logger.warn('Failed to delete thumbnails:', error);
      }

      // Delete GIF frame cache if applicable
      try {
        await gifFrameCache.clearMedia(mediaId);
      } catch (error) {
        logger.warn('Failed to delete GIF frame cache:', error);
      }

      // Delete proxy video if exists
      try {
        const allMedia = await getAllMediaDB();
        const sharedProxyKey = getSharedProxyKey(media);
        const hasSharedAlias = allMedia.some(
          (entry) => entry.id !== mediaId && getSharedProxyKey(entry) === sharedProxyKey
        );

        if (hasSharedAlias) {
          proxyService.clearProxyKey(mediaId);
        } else {
          await proxyService.deleteProxy(mediaId, sharedProxyKey);
        }
      } catch (error) {
        logger.warn('Failed to delete proxy:', error);
      } finally {
        proxyService.clearProxyKey(mediaId);
      }

      // For OPFS storage, handle content reference counting
      if (media.storageType === 'opfs' && media.contentHash) {
        const newRefCount = await decrementContentRef(media.contentHash);

        // If no more references to content, delete the actual file
        if (newRefCount === 0 && media.opfsPath) {
          try {
            await opfsService.deleteFile(media.opfsPath);
          } catch (error) {
            logger.warn('Failed to delete file from OPFS:', error);
          }

          // Delete content record
          try {
            await deleteContent(media.contentHash);
          } catch (error) {
            logger.warn('Failed to delete content record:', error);
          }
        }
      }
      // For handle storage: File stays on user's disk - nothing to delete
    }
  }

  /**
   * Delete multiple media items from a project in batch.
   * Uses parallel deletion for better performance.
   */
  async deleteMediaBatchFromProject(
    projectId: string,
    mediaIds: string[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      mediaIds.map((mediaId) => this.deleteMediaFromProject(projectId, mediaId))
    );

    const errors = results
      .map((result, i) => ({ result, id: mediaIds[i] }))
      .filter((r): r is { result: PromiseRejectedResult; id: string } =>
        r.result.status === 'rejected'
      );

    for (const { id, result } of errors) {
      logger.error(`Failed to delete media ${id}:`, result.reason);
    }

    if (errors.length === mediaIds.length) {
      throw new Error(
        `Failed to delete all ${mediaIds.length} items. Check console for details.`
      );
    }

    if (errors.length > 0) {
      logger.warn(
        `Partially deleted: ${mediaIds.length - errors.length}/${mediaIds.length} items deleted successfully.`
      );
    }
  }

  /**
   * Delete all media associations for a project.
   * Used when deleting a project. Uses parallel deletion for better performance.
   */
  async deleteAllMediaFromProject(projectId: string): Promise<void> {
    const mediaIds = await getProjectMediaIds(projectId);

    const results = await Promise.allSettled(
      mediaIds.map((mediaId) => this.deleteMediaFromProject(projectId, mediaId))
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logger.error(`Failed to delete media ${mediaIds[i]} from project:`, result.reason);
      }
    });
  }

  /**
   * @deprecated Use deleteMediaFromProject instead for proper reference counting
   */
  async deleteMedia(id: string): Promise<void> {
    logger.warn(
      'deleteMedia is deprecated. Use deleteMediaFromProject for proper reference counting.'
    );

    const media = await getMediaDB(id);
    if (!media) {
      throw new Error(`Media not found: ${id}`);
    }

    // Clean up all project-media associations for this media
    const projectIds = await getProjectsUsingMedia(id);
    for (const projectId of projectIds) {
      try {
        await removeMediaFromProjectDB(projectId, id);
      } catch (error) {
        logger.warn(`Failed to remove project association for ${projectId}:`, error);
      }
    }

    // Handle OPFS storage cleanup
    if (media.storageType === 'opfs' && media.contentHash) {
      const newRefCount = await decrementContentRef(media.contentHash);

      if (newRefCount === 0 && media.opfsPath) {
        try {
          await opfsService.deleteFile(media.opfsPath);
        } catch (error) {
          logger.warn('Failed to delete file from OPFS:', error);
        }

        try {
          await deleteContent(media.contentHash);
        } catch (error) {
          logger.warn('Failed to delete content record:', error);
        }
      }
    }
    // Handle storage: nothing to delete, file stays on disk

    this.clearThumbnailCache(id);
    try {
      await deleteThumbnailsByMediaId(id);
    } catch (error) {
      logger.warn('Failed to delete thumbnails:', error);
    }

    try {
      await proxyService.deleteProxy(id, getSharedProxyKey(media));
    } catch (error) {
      logger.warn('Failed to delete proxy:', error);
    } finally {
      proxyService.clearProxyKey(id);
    }

    await deleteMediaDB(id);
  }

  /**
   * @deprecated Use deleteMediaBatchFromProject instead
   */
  async deleteMediaBatch(ids: string[]): Promise<void> {
    logger.warn(
      'deleteMediaBatch is deprecated. Use deleteMediaBatchFromProject for proper reference counting.'
    );

    const errors: Array<{ id: string; error: unknown }> = [];

    for (const id of ids) {
      try {
        await this.deleteMedia(id);
      } catch (error) {
        logger.error(`Failed to delete media ${id}:`, error);
        errors.push({ id, error });
      }
    }

    if (errors.length === ids.length) {
      throw new Error(
        `Failed to delete all ${ids.length} items. Check console for details.`
      );
    }

    if (errors.length > 0) {
      logger.warn(
        `Partially deleted: ${ids.length - errors.length}/${ids.length} items deleted successfully.`
      );
    }
  }

  /**
   * Get all media for a specific project
   */
  async getMediaForProject(projectId: string): Promise<MediaMetadata[]> {
    return getMediaForProjectDB(projectId);
  }

  /**
   * Copy media to another project (no file duplication)
   *
   * For handle-based media, the file handle is shared.
   * For OPFS-based media, the content reference is incremented.
   */
  async copyMediaToProject(
    mediaId: string,
    targetProjectId: string
  ): Promise<void> {
    const media = await getMediaDB(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Create project association
    await associateMediaWithProject(targetProjectId, mediaId);

    // For OPFS storage, increment content reference
    if (media.storageType === 'opfs' && media.contentHash) {
      await incrementContentRef(media.contentHash);
    }
    // For handle storage, no additional action needed - handle is shared
  }

  /**
   * Get media file as Blob object
   *
   * Supports both storage types:
   * - 'handle': Reads from user's disk via FileSystemFileHandle (instant)
   * - 'opfs': Reads from Origin Private File System (legacy/fallback)
   *
   * @throws FileAccessError if permission denied or file missing
   */
  async getMediaFile(id: string): Promise<Blob | null> {
    const media = await getMediaDB(id);

    if (!media) {
      return null;
    }

    // Handle file handle storage (local-first)
    if (media.storageType === 'handle' && media.fileHandle) {
      try {
        const hasPermission = await ensureFileHandlePermission(media.fileHandle);
        if (!hasPermission) {
          throw new FileAccessError(
            `Permission denied for "${media.fileName}". Please re-grant access.`,
            'permission_denied'
          );
        }

        const file = await media.fileHandle.getFile();
        return file;
      } catch (error) {
        if (error instanceof FileAccessError) {
          throw error;
        }
        // File might have been moved/deleted
        logger.error('Failed to get file from handle:', error);
        throw new FileAccessError(
          `File "${media.fileName}" not found. It may have been moved or deleted.`,
          'file_missing'
        );
      }
    }

    // Handle OPFS storage (legacy/fallback)
    // Also handle old records without storageType (treat as OPFS)
    if (media.opfsPath) {
      try {
        const arrayBuffer = await opfsService.getFile(media.opfsPath);
        const blob = new Blob([arrayBuffer], {
          type: media.mimeType,
        });
        return blob;
      } catch (error) {
        logger.error('Failed to get media file from OPFS:', error);
        return null;
      }
    }

    logger.error('Media has no valid storage path:', id);
    return null;
  }

  /**
   * Check if a file handle needs permission re-request
   * Returns true if permission is needed, false if already granted or not a handle
   */
  async needsPermission(id: string): Promise<boolean> {
    const media = await getMediaDB(id);
    if (!media || media.storageType !== 'handle' || !media.fileHandle) {
      return false;
    }

    try {
      const permission = await media.fileHandle.queryPermission({ mode: 'read' });
      return permission !== 'granted';
    } catch {
      return true; // Error means we likely need permission
    }
  }

  /**
   * Request permission for a file handle
   * Returns true if granted, false otherwise
   */
  async requestPermission(id: string): Promise<boolean> {
    const media = await getMediaDB(id);
    if (!media || media.storageType !== 'handle' || !media.fileHandle) {
      return true; // Not a handle, no permission needed
    }

    return ensureFileHandlePermission(media.fileHandle);
  }

  /**
   * Get all media items that need permission re-request
   */
  async getMediaNeedingPermission(): Promise<MediaMetadata[]> {
    const allMedia = await getAllMediaDB();
    const needsPermission: MediaMetadata[] = [];

    for (const media of allMedia) {
      if (media.storageType === 'handle' && media.fileHandle) {
        try {
          const permission = await media.fileHandle.queryPermission({ mode: 'read' });
          if (permission !== 'granted') {
            needsPermission.push(media);
          }
        } catch {
          needsPermission.push(media);
        }
      }
    }

    return needsPermission;
  }

  /**
   * Relink a media item with a new file handle
   *
   * Updates the file handle for a media item that has become inaccessible
   * (file moved, renamed, or deleted). Only updates the handle and basic
   * file info - does not re-extract metadata or regenerate thumbnails.
   *
   * @param mediaId - The media ID to relink
   * @param newHandle - The new FileSystemFileHandle
   * @returns Updated MediaMetadata
   * @throws FileAccessError if permission denied or file inaccessible
   */
  async relinkMediaHandle(
    mediaId: string,
    newHandle: FileSystemFileHandle
  ): Promise<MediaMetadata> {
    // Get existing media
    const media = await getMediaDB(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Verify we have permission to access the new file
    const hasPermission = await ensureFileHandlePermission(newHandle);
    if (!hasPermission) {
      throw new FileAccessError(
        'Permission denied for the selected file',
        'permission_denied'
      );
    }

    // Verify file exists and get basic info
    const file = await newHandle.getFile();

    // Update metadata with new handle and file info
    const updated = await updateMediaDB(mediaId, {
      fileHandle: newHandle,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      updatedAt: Date.now(),
    });

    return updated;
  }

  /**
   * Get media file as blob URL (for preview/playback)
   */
  async getMediaBlobUrl(id: string): Promise<string | null> {
    const file = await this.getMediaFile(id);

    if (!file) {
      return null;
    }

    return URL.createObjectURL(file);
  }

  /**
   * Get thumbnail for a media item
   */
  async getThumbnail(mediaId: string): Promise<ThumbnailData | null> {
    const thumbnail = await getThumbnailByMediaId(mediaId);
    return thumbnail || null;
  }

  /**
   * Get thumbnail as blob URL (cached in memory to prevent flicker)
   */
  async getThumbnailBlobUrl(mediaId: string): Promise<string | null> {
    // Check cache first
    const cached = this.thumbnailUrlCache.get(mediaId);
    if (cached) {
      return cached;
    }

    const thumbnail = await this.getThumbnail(mediaId);

    if (!thumbnail) {
      return null;
    }

    const url = URL.createObjectURL(thumbnail.blob);
    this.thumbnailUrlCache.set(mediaId, url);
    return url;
  }

  /**
   * Clear thumbnail URL from cache (call when media is deleted)
   */
  clearThumbnailCache(mediaId: string): void {
    const url = this.thumbnailUrlCache.get(mediaId);
    if (url) {
      URL.revokeObjectURL(url);
      this.thumbnailUrlCache.delete(mediaId);
    }
  }

  /**
   * Validate sync between OPFS and IndexedDB
   * Returns list of issues found
   *
   * Note: Only validates OPFS-based media. Handle-based media is validated
   * separately via permission checks.
   */
  async validateSync(): Promise<{
    orphanedMetadata: string[]; // Metadata without OPFS file
    orphanedFiles: string[]; // OPFS files without metadata
  }> {
    const allMedia = await getAllMediaDB();
    const orphanedMetadata: string[] = [];
    const orphanedFiles: string[] = [];

    // Check each OPFS-based metadata entry has corresponding OPFS file
    for (const media of allMedia) {
      // Only check OPFS storage type
      if (media.storageType === 'opfs' && media.opfsPath) {
        try {
          await opfsService.getFile(media.opfsPath);
        } catch {
          // File not found in OPFS
          orphanedMetadata.push(media.id);
        }
      }
      // Handle-based storage is checked via needsPermission() instead
    }

    // Note: Checking for orphaned OPFS files would require listing all
    // files in OPFS and cross-referencing with metadata, which is expensive.
    // Can be implemented if needed.

    return { orphanedMetadata, orphanedFiles };
  }

  /**
   * Repair sync issues
   */
  async repairSync(): Promise<{ cleaned: number }> {
    const { orphanedMetadata } = await this.validateSync();

    // Clean up orphaned metadata
    for (const id of orphanedMetadata) {
      try {
        this.clearThumbnailCache(id);
        await deleteMediaDB(id);
        await deleteThumbnailsByMediaId(id);
      } catch (error) {
        logger.error(`Failed to cleanup orphaned metadata ${id}:`, error);
      }
    }

    return { cleaned: orphanedMetadata.length };
  }
}

// Singleton instance
export const mediaLibraryService = new MediaLibraryService();

