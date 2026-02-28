/**
 * Lightweight JSON Import Service
 *
 * Imports project data from JSON snapshots for debugging, testing,
 * and restoring project structure.
 */

import type { Project } from '@/types/project';
import {
  ProjectSnapshot,
  SnapshotImportOptions,
  SnapshotImportResult,
  SnapshotValidationResult,
  SnapshotValidationError,
  SnapshotValidationWarning,
  SNAPSHOT_VERSION,
} from '../types/snapshot';
import {
  validateSnapshot,
  formatValidationErrors,
  isVersionCompatible,
} from '../schemas/project-schema';
import { verifySnapshotChecksum } from './json-export-service';
import {
  createProject,
  getAllMedia,
  associateMediaWithProject,
} from '@/infrastructure/storage/indexeddb';

/**
 * Validate a snapshot without importing
 */
export async function validateSnapshotData(
  data: unknown
): Promise<SnapshotValidationResult> {
  const errors: SnapshotValidationError[] = [];
  const warnings: SnapshotValidationWarning[] = [];

  // Check if it's an object
  if (!data || typeof data !== 'object') {
    errors.push({
      path: '',
      message: 'Snapshot must be a valid JSON object',
      code: 'invalid_type',
    });
    return { valid: false, errors, warnings };
  }

  const snapshot = data as Record<string, unknown>;

  // Check version
  if (typeof snapshot.version !== 'string') {
    errors.push({
      path: 'version',
      message: 'Missing or invalid version field',
      code: 'missing_field',
    });
  } else if (!isVersionCompatible(snapshot.version)) {
    warnings.push({
      path: 'version',
      message: `Snapshot version ${snapshot.version} may not be fully compatible with current version ${SNAPSHOT_VERSION}`,
      code: 'version_mismatch',
    });
  }

  // Run Zod validation
  const validation = validateSnapshot(data);
  if (!validation.success && validation.errors) {
    const formattedErrors = formatValidationErrors(validation.errors);
    for (const msg of formattedErrors) {
      errors.push({
        path: msg.split(':')[0] || '',
        message: msg,
        code: 'schema_mismatch',
      });
    }
  }

  // Verify checksum if present
  if (validation.success && validation.data?.checksum) {
    const checksumValid = await verifySnapshotChecksum(validation.data as ProjectSnapshot);
    if (!checksumValid) {
      warnings.push({
        path: 'checksum',
        message: 'Snapshot checksum does not match - data may have been modified',
        code: 'unknown_field',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse JSON string to snapshot object
 */
function parseSnapshotJson(jsonString: string): unknown {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`);
  }
}

/**
 * Import a project from a snapshot
 */
async function importProjectFromSnapshot(
  snapshot: ProjectSnapshot,
  options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult> {
  const {
    generateNewIds = true,
    newProjectName,
    skipValidation = false,
    matchMediaByHash = true,
    matchMediaByName = true,
  } = options;

  const warnings: string[] = [];

  // Validate if not skipped
  if (!skipValidation) {
    const validation = await validateSnapshotData(snapshot);
    if (!validation.valid) {
      throw new Error(
        `Invalid snapshot: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }
    warnings.push(...validation.warnings.map((w) => w.message));
  }

  // Prepare project data
  let project: Project = { ...snapshot.project };

  // Generate new ID if requested
  if (generateNewIds) {
    project = {
      ...project,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Generate new IDs for timeline items
    if (project.timeline) {
      const trackIdMap = new Map<string, string>();
      const itemIdMap = new Map<string, string>();

      // Remap track IDs
      const newTracks = project.timeline.tracks.map((track) => {
        const newId = crypto.randomUUID();
        trackIdMap.set(track.id, newId);
        return { ...track, id: newId };
      });

      // Remap item IDs and track references
      const newItems = project.timeline.items.map((item) => {
        const newId = crypto.randomUUID();
        itemIdMap.set(item.id, newId);
        return {
          ...item,
          id: newId,
          trackId: trackIdMap.get(item.trackId) || item.trackId,
          originId: newId, // Reset originId
        };
      });

      // Remap marker IDs
      const newMarkers = project.timeline.markers?.map((marker) => ({
        ...marker,
        id: crypto.randomUUID(),
      }));

      // Remap transition IDs and clip references
      const newTransitions = project.timeline.transitions?.map((transition) => ({
        ...transition,
        id: crypto.randomUUID(),
        trackId: trackIdMap.get(transition.trackId) || transition.trackId,
        leftClipId: itemIdMap.get(transition.leftClipId) || transition.leftClipId,
        rightClipId: itemIdMap.get(transition.rightClipId) || transition.rightClipId,
      }));

      // Remap keyframe item references
      const newKeyframes = project.timeline.keyframes?.map((itemKeyframes) => ({
        ...itemKeyframes,
        itemId: itemIdMap.get(itemKeyframes.itemId) || itemKeyframes.itemId,
        properties: itemKeyframes.properties.map((prop) => ({
          ...prop,
          keyframes: prop.keyframes.map((kf) => ({
            ...kf,
            id: crypto.randomUUID(),
          })),
        })),
      }));

      project.timeline = {
        ...project.timeline,
        tracks: newTracks,
        items: newItems,
        markers: newMarkers,
        transitions: newTransitions,
        keyframes: newKeyframes,
      };
    }
  }

  // Override name if provided
  if (newProjectName) {
    project.name = newProjectName;
  }

  // Match media references to existing media
  const matchedMedia: SnapshotImportResult['matchedMedia'] = [];
  const unmatchedMedia: string[] = [];

  if (snapshot.mediaReferences.length > 0) {
    const existingMedia = await getAllMedia();

    for (const ref of snapshot.mediaReferences) {
      let matched = false;

      // Try to match by exact ID first
      const exactMatch = existingMedia.find((m) => m.id === ref.id);
      if (exactMatch) {
        matchedMedia.push({
          snapshotMediaId: ref.id,
          localMediaId: exactMatch.id,
          matchType: 'exact',
        });
        matched = true;
        continue;
      }

      // Try to match by content hash
      if (matchMediaByHash && ref.contentHash) {
        const hashMatch = existingMedia.find(
          (m) => m.contentHash && m.contentHash === ref.contentHash
        );
        if (hashMatch) {
          matchedMedia.push({
            snapshotMediaId: ref.id,
            localMediaId: hashMatch.id,
            matchType: 'hash',
          });
          matched = true;
          continue;
        }
      }

      // Try to match by filename and size
      if (matchMediaByName) {
        const nameMatch = existingMedia.find(
          (m) =>
            m.fileName === ref.fileName &&
            m.fileSize === ref.fileSize &&
            m.mimeType === ref.mimeType
        );
        if (nameMatch) {
          matchedMedia.push({
            snapshotMediaId: ref.id,
            localMediaId: nameMatch.id,
            matchType: 'name',
          });
          matched = true;
          continue;
        }
      }

      if (!matched) {
        unmatchedMedia.push(ref.id);
      }
    }

    // Remap media IDs in timeline items
    if (project.timeline && matchedMedia.length > 0) {
      const mediaIdMap = new Map(
        matchedMedia.map((m) => [m.snapshotMediaId, m.localMediaId])
      );

      project.timeline.items = project.timeline.items.map((item) => {
        if (item.mediaId && mediaIdMap.has(item.mediaId)) {
          return {
            ...item,
            mediaId: mediaIdMap.get(item.mediaId),
            // Clear cached URLs so they get regenerated
            src: undefined,
            thumbnailUrl: undefined,
          };
        }
        return item;
      });
    }

    // Add warnings for unmatched media
    if (unmatchedMedia.length > 0) {
      warnings.push(
        `${unmatchedMedia.length} media file(s) could not be matched to existing media`
      );
    }
  }

  // Save project to database
  await createProject(project);

  // Associate matched media with project
  for (const match of matchedMedia) {
    await associateMediaWithProject(project.id, match.localMediaId);
  }

  return {
    project,
    matchedMedia,
    unmatchedMedia,
    warnings,
  };
}

/**
 * Import a project from a JSON string
 */
export async function importProjectFromJsonString(
  jsonString: string,
  options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult> {
  const data = parseSnapshotJson(jsonString);
  const validation = await validateSnapshotData(data);

  if (!validation.valid) {
    throw new Error(
      `Invalid snapshot: ${validation.errors.map((e) => e.message).join(', ')}`
    );
  }

  return importProjectFromSnapshot(data as ProjectSnapshot, {
    ...options,
    skipValidation: true, // Already validated
  });
}

/**
 * Import a project from a file
 */
async function importProjectFromFile(
  file: File,
  options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult> {
  const text = await file.text();
  return importProjectFromJsonString(text, options);
}

/**
 * Read snapshot from clipboard
 */
async function readSnapshotFromClipboard(): Promise<ProjectSnapshot> {
  const text = await navigator.clipboard.readText();
  const data = parseSnapshotJson(text);
  const validation = await validateSnapshotData(data);

  if (!validation.valid) {
    throw new Error(
      `Invalid snapshot in clipboard: ${validation.errors.map((e) => e.message).join(', ')}`
    );
  }

  return data as ProjectSnapshot;
}

/**
 * Import a project from clipboard
 */
export async function importProjectFromClipboard(
  options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult> {
  const snapshot = await readSnapshotFromClipboard();
  return importProjectFromSnapshot(snapshot, {
    ...options,
    skipValidation: true, // Already validated
  });
}

/**
 * Show file picker and import snapshot
 */
export async function showImportFilePicker(
  options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult | null> {
  // Create file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.freecut.json';

  return new Promise((resolve) => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const result = await importProjectFromFile(file, options);
      resolve(result);
    };

    input.oncancel = () => resolve(null);
    input.click();
  });
}

