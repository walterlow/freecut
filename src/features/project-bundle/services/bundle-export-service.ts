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
import { getProject, getProjectMediaIds } from '@/lib/storage/indexeddb';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { computeContentHashFromBuffer } from '@/features/media-library/utils/content-hash';

// App version - should be imported from a config
const APP_VERSION = '1.0.0';

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
  const zip = new Zip((err, chunk, _final) => {
    if (err) throw err;
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
  const mediaIdToPath = new Map<string, string>();

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
    mediaIdToPath.set(media.id, relativePath);

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

  onProgress?.({ percent: 85, stage: 'packaging' });

  // Step 6: Create project.json with mediaRef instead of mediaId
  const bundleProject: BundleProject = {
    ...project,
    timeline: project.timeline
      ? {
          ...project.timeline,
          items: project.timeline.items.map((item) => {
            const { mediaId, src, thumbnailUrl, ...rest } = item;
            return {
              ...rest,
              mediaRef: mediaId, // Rename mediaId to mediaRef
            };
          }),
        }
      : undefined,
  };

  const projectFile = new ZipDeflate('project.json');
  zip.add(projectFile);
  projectFile.push(
    new TextEncoder().encode(JSON.stringify(bundleProject, null, 2)),
    true
  );

  // Step 7: Compute manifest checksum and add manifest.json
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

  // Step 8: Finalize ZIP
  zip.end();

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
 * Trigger browser download of exported bundle
 */
export function downloadBundle(result: ExportResult): void {
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
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}
