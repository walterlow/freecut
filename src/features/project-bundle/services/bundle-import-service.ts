/**
 * Project Bundle Import Service
 *
 * Imports a .freecut.zip bundle (ZIP archive) and creates a project with media.
 * Media files are extracted to a user-selected directory and referenced via
 * FileSystemFileHandle for local-first storage.
 */

import { unzip } from 'fflate';
import type { Project } from '@/types/project';
import type { MediaMetadata, ThumbnailData } from '@/types/storage';
import type {
  BundleManifest,
  BundleProject,
  ImportProgress,
  ImportResult,
  ImportOptions,
  ImportConflict,
} from '../types/bundle';
import {
  createProject,
  createMedia,
  saveThumbnail,
  associateMediaWithProject,
  updateProject,
} from '@/infrastructure/storage/indexeddb';
import { generateThumbnail } from '@/features/project-bundle/deps/media-library';
import { fileSystemService } from './file-system-service';

/**
 * Import a project bundle
 *
 * @param file - The .freecut.zip bundle file to import
 * @param destinationDirectory - Directory where media files will be extracted (must be provided by caller)
 * @param options - Import options (new name, etc.)
 * @param onProgress - Progress callback
 * @returns Import result with project and media counts
 */
export async function importProjectBundle(
  file: File,
  destinationDirectory: FileSystemDirectoryHandle,
  options: Omit<ImportOptions, 'destinationDirectory'> = {},
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const conflicts: ImportConflict[] = [];

  // Step 1: Validate bundle
  onProgress?.({ percent: 0, stage: 'validating' });
  const validation = await validateBundle(file);
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Invalid bundle: ${validation.errors.join(', ')}`);
  }

  const manifest = validation.manifest;
  onProgress?.({ percent: 10, stage: 'validating' });

  // Step 2: Unzip bundle to memory
  const files = await unzipBundle(file);
  const bundleProject = JSON.parse(
    new TextDecoder().decode(files['project.json'])
  ) as BundleProject;

  // Step 3: Create project subdirectory in destination
  const projectName = options.newProjectName ?? bundleProject.name;
  const projectDir = await fileSystemService.getOrCreateSubdirectory(
    destinationDirectory,
    projectName
  );

  // Step 5: Extract and import media files
  onProgress?.({ percent: 20, stage: 'extracting' });
  const mediaIdMap = new Map<string, string>(); // originalId -> newId
  const totalMedia = manifest.media.length;
  let imported = 0;
  let skipped = 0;

  for (const entry of manifest.media) {
    const percent = 20 + ((manifest.media.indexOf(entry) + 1) / totalMedia) * 50;

    onProgress?.({
      percent,
      stage: 'extracting',
      currentFile: entry.fileName,
    });

    try {
      // Get the file data from the unzipped bundle
      const fileData = files[entry.relativePath];
      if (!fileData) {
        console.warn(`Missing file in bundle: ${entry.relativePath}`);
        skipped++;
        continue;
      }

      // Generate unique filename if needed
      const uniqueFileName = await fileSystemService.getUniqueFileName(
        projectDir,
        entry.fileName
      );

      // Write file to destination directory
      const fileHandle = await fileSystemService.writeFile(
        projectDir,
        uniqueFileName,
        fileData
      );

      // Create new media ID
      const newMediaId = crypto.randomUUID();
      mediaIdMap.set(entry.originalId, newMediaId);

      // Generate thumbnail from the extracted file
      onProgress?.({
        percent,
        stage: 'importing_media',
        currentFile: entry.fileName,
      });

      let thumbnailId: string | undefined;
      try {
        const extractedFile = await fileHandle.getFile();
        const thumbnailBlob = await generateThumbnail(extractedFile);
        thumbnailId = crypto.randomUUID();

        const thumbnailData: ThumbnailData = {
          id: thumbnailId,
          mediaId: newMediaId,
          blob: thumbnailBlob,
          timestamp: 1,
          width: 320,
          height: 180,
        };
        await saveThumbnail(thumbnailData);
      } catch (thumbnailError) {
        console.warn(
          `Failed to generate thumbnail for ${entry.fileName}:`,
          thumbnailError
        );
        // Continue without thumbnail - not critical
      }

      // Create media metadata entry
      const mediaMetadata: MediaMetadata = {
        id: newMediaId,
        storageType: 'handle',
        fileHandle,
        fileName: uniqueFileName,
        fileSize: entry.fileSize,
        mimeType: entry.mimeType,
        contentHash: entry.sha256,
        duration: entry.metadata.duration,
        width: entry.metadata.width,
        height: entry.metadata.height,
        fps: entry.metadata.fps,
        codec: entry.metadata.codec,
        bitrate: entry.metadata.bitrate,
        thumbnailId,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await createMedia(mediaMetadata);
      imported++;
    } catch (error) {
      console.error(`Failed to import media ${entry.fileName}:`, error);
      conflicts.push({
        type: 'media_duplicate',
        description: `Failed to import: ${entry.fileName}`,
        resolution: 'skip',
        originalValue: entry.fileName,
      });
      skipped++;
    }
  }

  // Step 6: Create project with remapped timeline
  onProgress?.({ percent: 85, stage: 'linking' });

  const newProjectId = crypto.randomUUID();
  const importNote = `Imported from Project ${bundleProject.name}`;
  const project: Project = {
    id: newProjectId,
    name: projectName,
    description: bundleProject.description
      ? `${bundleProject.description}\n\n${importNote}`
      : importNote,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    duration: bundleProject.duration,
    thumbnail: bundleProject.thumbnail,
    metadata: bundleProject.metadata,
    // Store the project folder handle for smarter relinking and path display
    rootFolderHandle: projectDir,
    rootFolderName: projectName,
    timeline: bundleProject.timeline
      ? {
          tracks: bundleProject.timeline.tracks,
          items: bundleProject.timeline.items.map((item) => {
            // Remap mediaRef to mediaId
            const { mediaRef, ...rest } = item;
            return {
              ...rest,
              mediaId: mediaRef ? mediaIdMap.get(mediaRef) : undefined,
              // Clear src/thumbnailUrl since they'll be regenerated from mediaId
              src: undefined,
              thumbnailUrl: undefined,
            };
          }),
          // Also remap sub-composition items
          compositions: bundleProject.timeline.compositions?.map((comp) => ({
            ...comp,
            items: comp.items.map((item) => {
              const { mediaRef, ...rest } = item;
              return {
                ...rest,
                mediaId: mediaRef ? mediaIdMap.get(mediaRef) : undefined,
                src: undefined,
                thumbnailUrl: undefined,
              };
            }),
          })),
          currentFrame: bundleProject.timeline.currentFrame,
          zoomLevel: bundleProject.timeline.zoomLevel,
          inPoint: bundleProject.timeline.inPoint,
          outPoint: bundleProject.timeline.outPoint,
        }
      : undefined,
  };

  await createProject(project);

  // Step 7: Restore project cover thumbnail if exists in bundle
  const coverData = files['cover.jpg'];
  if (coverData) {
    try {
      const blob = new Blob([new Uint8Array(coverData)], { type: 'image/jpeg' });
      const thumbnailId = `project:${newProjectId}:cover`;
      await saveThumbnail({
        id: thumbnailId,
        mediaId: newProjectId, // Use project ID as mediaId for cover thumbnails
        blob,
        timestamp: Date.now(),
        width: 320, // Default thumbnail dimensions
        height: 180,
      });
      // Update project with thumbnailId
      project.thumbnailId = thumbnailId;
      // Note: Project already created above, need to update it
      await updateProject(newProjectId, { thumbnailId });
    } catch (err) {
      // Thumbnail restoration is optional, continue without it
      console.warn('Could not restore project thumbnail:', err);
    }
  }

  // Step 8: Associate all imported media with the project
  onProgress?.({ percent: 95, stage: 'linking' });

  for (const [, newMediaId] of mediaIdMap) {
    await associateMediaWithProject(newProjectId, newMediaId);
  }

  onProgress?.({ percent: 100, stage: 'complete' });

  return {
    project,
    mediaImported: imported,
    mediaSkipped: skipped,
    conflicts,
  };
}

/**
 * Unzip a bundle file to memory
 */
async function unzipBundle(file: File): Promise<Record<string, Uint8Array>> {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Validate a bundle file without importing
 */
async function validateBundle(file: File): Promise<{
  valid: boolean;
  manifest?: BundleManifest;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    const files = await unzipBundle(file);

    // Check manifest
    if (!files['manifest.json']) {
      errors.push('Missing manifest.json');
      return { valid: false, errors };
    }

    const manifest: BundleManifest = JSON.parse(
      new TextDecoder().decode(files['manifest.json'])
    );

    // Check project.json
    if (!files['project.json']) {
      errors.push('Missing project.json');
      return { valid: false, manifest, errors };
    }

    // Verify checksum
    const manifestForHash = { ...manifest, checksum: '' };
    const computedHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(manifestForHash))
    );
    const computedChecksum = Array.from(new Uint8Array(computedHashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedChecksum !== manifest.checksum) {
      errors.push('Checksum mismatch - file may be corrupted');
      return { valid: false, manifest, errors };
    }

    // Check media files exist
    for (const media of manifest.media) {
      if (!files[media.relativePath]) {
        errors.push(`Missing media file: ${media.fileName}`);
      }
    }

    return {
      valid: errors.length === 0,
      manifest,
      errors,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown error');
    return { valid: false, errors };
  }
}

