/**
 * Lightweight JSON Export Service
 *
 * Exports project data as JSON for debugging, testing, and sharing
 * project structure without media files.
 */

import type { Project } from '@/types/project';
import type { MediaMetadata } from '@/types/storage';
import {
  ProjectSnapshot,
  SnapshotExportOptions,
  SnapshotMediaReference,
  SNAPSHOT_VERSION,
  mediaToSnapshotReference,
} from '../types/snapshot';
import { getProject, getProjectMediaIds } from '@/infrastructure/storage/indexeddb';
import { mediaLibraryService } from '@/features/project-bundle/deps/media-library';

// App version - should be imported from a config
const APP_VERSION = '1.0.0';

/**
 * Export a project as a lightweight JSON snapshot
 */
export async function exportProjectJson(
  projectId: string,
  options: SnapshotExportOptions = {}
): Promise<ProjectSnapshot> {
  const {
    includeMediaReferences = true,
    stripVolatileFields = false,
    includeChecksum = true,
  } = options;

  // Get project data
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Prepare project data
  let projectData: Project = { ...project };

  // Strip volatile fields if requested
  if (stripVolatileFields && projectData.timeline) {
    projectData = {
      ...projectData,
      timeline: {
        ...projectData.timeline,
        currentFrame: undefined,
        zoomLevel: undefined,
        scrollPosition: undefined,
      },
    };
  }

  // Collect media references if requested
  const mediaReferences: SnapshotMediaReference[] = [];
  if (includeMediaReferences) {
    const mediaIds = await getProjectMediaIds(projectId);
    for (const mediaId of mediaIds) {
      const media = await mediaLibraryService.getMedia(mediaId);
      if (media) {
        mediaReferences.push(mediaToSnapshotReference(media));
      }
    }
  }

  // Create snapshot
  const snapshot: ProjectSnapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    editorVersion: APP_VERSION,
    project: projectData,
    mediaReferences,
  };

  // Compute checksum if requested
  if (includeChecksum) {
    snapshot.checksum = await computeSnapshotChecksum(snapshot);
  }

  return snapshot;
}

/**
 * Export a project snapshot as a JSON string
 */
export async function exportProjectJsonString(
  projectId: string,
  options: SnapshotExportOptions = {}
): Promise<string> {
  const { prettyPrint = true, ...restOptions } = options;
  const snapshot = await exportProjectJson(projectId, restOptions);
  return JSON.stringify(snapshot, null, prettyPrint ? 2 : 0);
}

/**
 * Export current timeline state (for debugging)
 * Takes a project object directly instead of loading from DB
 */
export function createSnapshotFromProject(
  project: Project,
  mediaMetadata: MediaMetadata[] = [],
  options: SnapshotExportOptions = {}
): ProjectSnapshot {
  const { stripVolatileFields = false } = options;

  let projectData: Project = { ...project };

  if (stripVolatileFields && projectData.timeline) {
    projectData = {
      ...projectData,
      timeline: {
        ...projectData.timeline,
        currentFrame: undefined,
        zoomLevel: undefined,
        scrollPosition: undefined,
      },
    };
  }

  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    editorVersion: APP_VERSION,
    project: projectData,
    mediaReferences: mediaMetadata.map(mediaToSnapshotReference),
  };
}

/**
 * Download snapshot as a JSON file
 */
export function downloadSnapshotJson(snapshot: ProjectSnapshot, filename?: string): void {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const safeName = sanitizeFilename(filename || snapshot.project.name);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.freecut.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download project directly as JSON file
 */
export async function downloadProjectJson(
  projectId: string,
  options: SnapshotExportOptions = {}
): Promise<void> {
  const snapshot = await exportProjectJson(projectId, options);
  downloadSnapshotJson(snapshot);
}

/**
 * Copy snapshot to clipboard as JSON
 */
async function copySnapshotToClipboard(snapshot: ProjectSnapshot): Promise<void> {
  const json = JSON.stringify(snapshot, null, 2);
  await navigator.clipboard.writeText(json);
}

/**
 * Copy project to clipboard as JSON
 */
export async function copyProjectToClipboard(
  projectId: string,
  options: SnapshotExportOptions = {}
): Promise<void> {
  const snapshot = await exportProjectJson(projectId, options);
  await copySnapshotToClipboard(snapshot);
}

/**
 * Compute SHA-256 checksum for snapshot integrity
 */
async function computeSnapshotChecksum(snapshot: ProjectSnapshot): Promise<string> {
  // Create a copy without the checksum field for hashing
  const dataForHash = { ...snapshot, checksum: undefined };
  const json = JSON.stringify(dataForHash);
  const buffer = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify snapshot checksum
 */
export async function verifySnapshotChecksum(snapshot: ProjectSnapshot): Promise<boolean> {
  if (!snapshot.checksum) {
    return true; // No checksum to verify
  }

  const expectedChecksum = snapshot.checksum;
  const actualChecksum = await computeSnapshotChecksum(snapshot);
  return expectedChecksum === actualChecksum;
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

/**
 * Get snapshot statistics for display
 */
export function getSnapshotStats(snapshot: ProjectSnapshot): {
  trackCount: number;
  itemCount: number;
  mediaCount: number;
  markerCount: number;
  transitionCount: number;
  keyframeCount: number;
  totalDuration: number;
} {
  const timeline = snapshot.project.timeline;
  return {
    trackCount: timeline?.tracks.length ?? 0,
    itemCount: timeline?.items.length ?? 0,
    mediaCount: snapshot.mediaReferences.length,
    markerCount: timeline?.markers?.length ?? 0,
    transitionCount: timeline?.transitions?.length ?? 0,
    keyframeCount: timeline?.keyframes?.reduce(
      (sum, item) => sum + item.properties.reduce(
        (pSum, prop) => pSum + prop.keyframes.length, 0
      ), 0
    ) ?? 0,
    totalDuration: snapshot.project.duration,
  };
}

