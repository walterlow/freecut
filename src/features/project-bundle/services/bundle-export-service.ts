/**
 * Project Bundle Export Service
 *
 * Exports a project with all its media as a .freecut.zip bundle
 */

import { Zip, ZipPassThrough, ZipDeflate } from 'fflate';
import type { MediaMetadata } from '@/types/storage';
import {
  BundleManifest,
  BundleProject,
  ExportProgress,
  ExportResult,
  BUNDLE_VERSION,
  BUNDLE_EXTENSION,
} from '../types/bundle';
import { getProject, getProjectMediaIds, getThumbnail } from '@/lib/storage/indexeddb';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { computeContentHashFromBuffer } from '@/features/media-library/utils/content-hash';

import type { ProjectTimeline } from '@/types/project';

// App version - should be imported from a config
const APP_VERSION = '1.0.0';

/**
 * Convert timeline items for bundle: strip preview URLs (src, thumbnailUrl)
 * and rename mediaId → mediaRef for portable references.
 */
function convertItemsForBundle(items: ProjectTimeline['items']) {
  return items.map((item) => {
    const { mediaId, ...rest } = item;
    const itemWithoutPreviewUrls = { ...rest };
    delete itemWithoutPreviewUrls.src;
    delete itemWithoutPreviewUrls.thumbnailUrl;
    return {
      ...itemWithoutPreviewUrls,
      mediaRef: mediaId,
    };
  });
}

/**
 * Export a project as a bundle
 */
export async function exportProjectBundle(
  projectId: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  onProgress?.({ percent: 0, stage: 'collecting' });

  // Step 1: Get project data
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Step 2: Get all media IDs for this project
  const mediaIds = await getProjectMediaIds(projectId);
  onProgress?.({ percent: 10, stage: 'collecting' });

  // Step 3: Collect media metadata
  const mediaItems: MediaMetadata[] = [];
  for (const mediaId of mediaIds) {
    const media = await mediaLibraryService.getMedia(mediaId);
    if (media) {
      mediaItems.push(media);
    }
  }

  const totalItems = mediaItems.length;
  onProgress?.({ percent: 15, stage: 'hashing' });

  // Step 4: Build manifest and prepare ZIP
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) { zipError = err; return; }
    if (chunk) chunks.push(chunk);
  });

  const manifest: BundleManifest = {
    version: BUNDLE_VERSION,
    createdAt: Date.now(),
    editorVersion: APP_VERSION,
    projectId: project.id,
    projectName: project.name,
    media: [],
    checksum: '', // Computed at end
  };

  // Track unique filenames in bundle
  const usedFilenames = new Set<string>();

  // Step 5: Add media files to ZIP
  onProgress?.({ percent: 20, stage: 'packaging' });

  for (let i = 0; i < mediaItems.length; i++) {
    if (zipError) break;

    const media = mediaItems[i];
    if (!media) continue;

    const progress = 20 + ((i + 1) / totalItems) * 60;

    onProgress?.({
      percent: progress,
      stage: 'packaging',
      currentFile: media.fileName,
    });

    // Get media file content
    const blob = await mediaLibraryService.getMediaFile(media.id);
    if (!blob) {
      console.warn(`Could not get file for media: ${media.id}`);
      continue;
    }

    const buffer = await blob.arrayBuffer();

    // Use content hash for dedup within bundle
    const hash = media.contentHash || (await computeContentHashFromBuffer(buffer));

    // Ensure unique filename within bundle
    let bundleFileName = media.fileName;
    let counter = 1;
    while (usedFilenames.has(`${hash}/${bundleFileName}`)) {
      const ext = media.fileName.lastIndexOf('.');
      if (ext > 0) {
        bundleFileName = `${media.fileName.substring(0, ext)}_${counter}${media.fileName.substring(ext)}`;
      } else {
        bundleFileName = `${media.fileName}_${counter}`;
      }
      counter++;
    }
    usedFilenames.add(`${hash}/${bundleFileName}`);

    const relativePath = `media/${hash}/${bundleFileName}`;

    // Add to manifest
    manifest.media.push({
      originalId: media.id,
      relativePath,
      fileName: media.fileName,
      fileSize: media.fileSize,
      sha256: hash,
      mimeType: media.mimeType,
      metadata: {
        duration: media.duration,
        width: media.width,
        height: media.height,
        fps: media.fps,
        codec: media.codec,
        bitrate: media.bitrate,
      },
    });

    // Add file to ZIP (no compression for media - already compressed)
    const mediaFile = new ZipPassThrough(relativePath);
    zip.add(mediaFile);
    mediaFile.push(new Uint8Array(buffer), true);
  }

  if (zipError) throw zipError;

  onProgress?.({ percent: 85, stage: 'packaging' });

  // Step 6: Create project.json with mediaRef instead of mediaId
  const bundleProject: BundleProject = {
    ...project,
    timeline: project.timeline
      ? {
          ...project.timeline,
          items: convertItemsForBundle(project.timeline.items),
          // Also process sub-composition items
          compositions: project.timeline.compositions?.map((comp) => ({
            ...comp,
            items: convertItemsForBundle(comp.items as ProjectTimeline['items']),
          })),
        }
      : undefined,
  };

  const projectFile = new ZipDeflate('project.json');
  zip.add(projectFile);
  projectFile.push(
    new TextEncoder().encode(JSON.stringify(bundleProject, null, 2)),
    true
  );

  // Step 7: Add project cover thumbnail if exists
  if (project.thumbnailId) {
    try {
      const thumbnailData = await getThumbnail(project.thumbnailId);
      if (thumbnailData?.blob) {
        const thumbnailBuffer = await thumbnailData.blob.arrayBuffer();
        const thumbnailFile = new ZipPassThrough('cover.jpg');
        zip.add(thumbnailFile);
        thumbnailFile.push(new Uint8Array(thumbnailBuffer), true);
      }
    } catch (err) {
      // Thumbnail is optional, continue without it
      console.warn('Could not export project thumbnail:', err);
    }
  }

  // Step 8: Compute manifest checksum and add manifest.json
  const manifestForHash = { ...manifest, checksum: '' };
  const manifestHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(manifestForHash))
  );
  manifest.checksum = Array.from(new Uint8Array(manifestHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const manifestFile = new ZipDeflate('manifest.json');
  zip.add(manifestFile);
  manifestFile.push(
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    true
  );

  // Step 9: Finalize ZIP
  zip.end();

  if (zipError) throw zipError;

  onProgress?.({ percent: 100, stage: 'complete' });

  // Combine chunks into final blob
  const totalSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  const blob = new Blob([result], { type: 'application/zip' });
  const filename = sanitizeFilename(project.name) + BUNDLE_EXTENSION;

  return {
    blob,
    filename,
    size: blob.size,
    mediaCount: manifest.media.length,
  };
}

/**
 * Export a project bundle using streaming write to disk.
 * Requires File System Access API (Chrome/Edge).
 * The file handle must be obtained before calling this function.
 */
export async function exportProjectBundleStreaming(
  projectId: string,
  fileHandle: FileSystemFileHandle,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  const writable = await fileHandle.createWritable();
  let totalSize = 0;
  const writePromises: Promise<void>[] = [];
  let zipError: Error | null = null;

  try {
    onProgress?.({ percent: 0, stage: 'collecting' });

    // Step 1: Get project data
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Step 2: Get all media IDs for this project
    const mediaIds = await getProjectMediaIds(projectId);
    onProgress?.({ percent: 10, stage: 'collecting' });

    // Step 3: Collect media metadata
    const mediaItems: MediaMetadata[] = [];
    for (const mediaId of mediaIds) {
      const media = await mediaLibraryService.getMedia(mediaId);
      if (media) {
        mediaItems.push(media);
      }
    }

    const totalItems = mediaItems.length;
    onProgress?.({ percent: 15, stage: 'hashing' });

    // Step 4: Build manifest and prepare ZIP — stream chunks to disk
    // Collect write promises since fflate's Zip callback is synchronous and won't await
    const zip = new Zip((err, chunk) => {
      if (err) { zipError = err; return; }
      if (chunk) {
        totalSize += chunk.length;
        writePromises.push(writable.write(chunk));
      }
    });

    const manifest: BundleManifest = {
      version: BUNDLE_VERSION,
      createdAt: Date.now(),
      editorVersion: APP_VERSION,
      projectId: project.id,
      projectName: project.name,
      media: [],
      checksum: '',
    };

    const usedFilenames = new Set<string>();

    // Step 5: Add media files to ZIP
    onProgress?.({ percent: 20, stage: 'packaging' });

    for (let i = 0; i < mediaItems.length; i++) {
      const media = mediaItems[i];
      if (!media) continue;

      const progress = 20 + ((i + 1) / totalItems) * 60;
      onProgress?.({
        percent: progress,
        stage: 'packaging',
        currentFile: media.fileName,
      });

      const blob = await mediaLibraryService.getMediaFile(media.id);
      if (!blob) {
        console.warn(`Could not get file for media: ${media.id}`);
        continue;
      }

      const buffer = await blob.arrayBuffer();
      const hash = media.contentHash || (await computeContentHashFromBuffer(buffer));

      let bundleFileName = media.fileName;
      let counter = 1;
      while (usedFilenames.has(`${hash}/${bundleFileName}`)) {
        const ext = media.fileName.lastIndexOf('.');
        if (ext > 0) {
          bundleFileName = `${media.fileName.substring(0, ext)}_${counter}${media.fileName.substring(ext)}`;
        } else {
          bundleFileName = `${media.fileName}_${counter}`;
        }
        counter++;
      }
      usedFilenames.add(`${hash}/${bundleFileName}`);

      const relativePath = `media/${hash}/${bundleFileName}`;

      manifest.media.push({
        originalId: media.id,
        relativePath,
        fileName: media.fileName,
        fileSize: media.fileSize,
        sha256: hash,
        mimeType: media.mimeType,
        metadata: {
          duration: media.duration,
          width: media.width,
          height: media.height,
          fps: media.fps,
          codec: media.codec,
          bitrate: media.bitrate,
        },
      });

      const mediaFile = new ZipPassThrough(relativePath);
      zip.add(mediaFile);
      mediaFile.push(new Uint8Array(buffer), true);

      // Stop processing remaining media if zip encountered an error
      if (zipError) break;
    }

    if (zipError) throw zipError;

    onProgress?.({ percent: 85, stage: 'packaging' });

    // Step 6: Create project.json
    const bundleProject: BundleProject = {
      ...project,
      timeline: project.timeline
        ? {
            ...project.timeline,
            items: convertItemsForBundle(project.timeline.items),
            compositions: project.timeline.compositions?.map((comp) => ({
              ...comp,
              items: convertItemsForBundle(comp.items as ProjectTimeline['items']),
            })),
          }
        : undefined,
    };

    const projectFile = new ZipDeflate('project.json');
    zip.add(projectFile);
    projectFile.push(
      new TextEncoder().encode(JSON.stringify(bundleProject, null, 2)),
      true
    );

    // Step 7: Add project cover thumbnail if exists
    if (project.thumbnailId) {
      try {
        const thumbnailData = await getThumbnail(project.thumbnailId);
        if (thumbnailData?.blob) {
          const thumbnailBuffer = await thumbnailData.blob.arrayBuffer();
          const thumbnailFile = new ZipPassThrough('cover.jpg');
          zip.add(thumbnailFile);
          thumbnailFile.push(new Uint8Array(thumbnailBuffer), true);
        }
      } catch (err) {
        console.warn('Could not export project thumbnail:', err);
      }
    }

    // Step 8: Compute manifest checksum and add manifest.json
    const manifestForHash = { ...manifest, checksum: '' };
    const manifestHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(manifestForHash))
    );
    manifest.checksum = Array.from(new Uint8Array(manifestHashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const manifestFile = new ZipDeflate('manifest.json');
    zip.add(manifestFile);
    manifestFile.push(
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      true
    );

    // Step 9: Finalize ZIP
    zip.end();

    if (zipError) throw zipError;

    // Wait for all writes to flush, then close the stream
    await Promise.all(writePromises);
    await writable.close();

    onProgress?.({ percent: 100, stage: 'complete' });

    const filename = sanitizeFilename(project.name) + BUNDLE_EXTENSION;

    return {
      filename,
      size: totalSize,
      mediaCount: manifest.media.length,
    };
  } catch (err) {
    // Settle any pending writes to avoid unhandled rejections
    if (writePromises.length > 0) {
      await Promise.allSettled(writePromises);
    }
    // Clean up partial file on error
    try {
      await writable.abort();
    } catch {
      // Ignore abort errors
    }
    throw err;
  }
}

/**
 * Trigger browser download of exported bundle
 */
export function downloadBundle(result: ExportResult): void {
  if (!result.blob) return; // Streaming export already saved to disk

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize filename for safe download
 */
function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
  return sanitized || 'untitled';
}
