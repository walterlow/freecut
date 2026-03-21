/**
 * Debug Utilities for Project Data
 *
 * Exposes debugging functions on window.__DEBUG__ in development mode.
 * Useful for testing, debugging, and inspecting project state.
 */

import type { Project } from '@/types/project';
import type { ProjectSnapshot, SnapshotExportOptions, SnapshotImportOptions } from '@/features/project-bundle/types/snapshot';
import type { FixtureType, FixtureOptions, FixtureResult } from '@/features/project-bundle/services/test-fixtures';
import {
  exportProjectJson,
  exportProjectJsonString,
  downloadProjectJson,
  copyProjectToClipboard,
  getSnapshotStats,
  createSnapshotFromProject,
} from '@/features/project-bundle/services/json-export-service';
import {
  importProjectFromJsonString,
  importProjectFromClipboard,
  validateSnapshotData,
  showImportFilePicker,
} from '@/features/project-bundle/services/json-import-service';
import {
  validateProject,
  formatValidationErrors,
} from '@/features/project-bundle/schemas/project-schema';
import {
  getAllProjects,
  getProject,
  getAllMedia,
  getProjectMediaIds,
  getDBStats,
  createProject,
} from '@/infrastructure/storage/indexeddb';

/**
 * Debug API interface
 */
interface ProjectDebugAPI {
  // Export functions
  exportProject: (projectId: string, options?: SnapshotExportOptions) => Promise<ProjectSnapshot>;
  exportProjectString: (projectId: string, options?: SnapshotExportOptions) => Promise<string>;
  downloadProject: (projectId: string, options?: SnapshotExportOptions) => Promise<void>;
  copyProjectToClipboard: (projectId: string, options?: SnapshotExportOptions) => Promise<void>;

  // Import functions
  importFromJson: (json: string, options?: SnapshotImportOptions) => Promise<Project>;
  importFromClipboard: (options?: SnapshotImportOptions) => Promise<Project>;
  importFromFile: (options?: SnapshotImportOptions) => Promise<Project | null>;

  // Validation functions
  validateProject: (data: unknown) => { valid: boolean; errors?: string[] };
  validateSnapshot: (data: unknown) => Promise<{ valid: boolean; errors?: string[]; warnings?: string[] }>;

  // Inspection functions
  getProject: (projectId: string) => Promise<Project | undefined>;
  getAllProjects: () => Promise<Project[]>;
  getProjectMedia: (projectId: string) => Promise<string[]>;
  getAllMedia: () => Promise<unknown[]>;
  getDBStats: () => Promise<unknown>;
  getSnapshotStats: (snapshot: ProjectSnapshot) => ReturnType<typeof getSnapshotStats>;

  // Utility functions
  createSnapshot: (project: Project) => ProjectSnapshot;
  parseJson: (json: string) => unknown;

  // Fixture functions
  generateFixture: (type: FixtureType, options?: FixtureOptions) => Promise<FixtureResult>;
  createFixtureProject: (type: FixtureType, options?: FixtureOptions) => Promise<Project>;
  listFixtures: () => Promise<Array<{ type: FixtureType; name: string; description: string }>>;

  // Playback control (for debugging)
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;

  // Timeline inspection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getItemsAtFrame: (frame: number) => Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUpcomingItems: (frame: number, lookahead: number) => Promise<any[]>;

  // Version info
  version: string;
}

/**
 * Create the debug API object
 */
function createDebugAPI(): ProjectDebugAPI {
  return {
    // Export functions
    exportProject: async (projectId, options) => {
      return exportProjectJson(projectId, options);
    },

    exportProjectString: async (projectId, options) => {
      return exportProjectJsonString(projectId, options);
    },

    downloadProject: async (projectId, options) => {
      await downloadProjectJson(projectId, options);
    },

    copyProjectToClipboard: async (projectId, options) => {
      await copyProjectToClipboard(projectId, options);
    },

    // Import functions
    importFromJson: async (json, options) => {
      const result = await importProjectFromJsonString(json, options);
      return result.project;
    },

    importFromClipboard: async (options) => {
      const result = await importProjectFromClipboard(options);
      return result.project;
    },

    importFromFile: async (options) => {
      const result = await showImportFilePicker(options);
      return result?.project ?? null;
    },

    // Validation functions
    validateProject: (data) => {
      const result = validateProject(data);
      if (result.success) {
        return { valid: true };
      }
      return {
        valid: false,
        errors: result.errors ? formatValidationErrors(result.errors) : [],
      };
    },

    validateSnapshot: async (data) => {
      const result = await validateSnapshotData(data);
      return {
        valid: result.valid,
        errors: result.errors.map((e) => e.message),
        warnings: result.warnings.map((w) => w.message),
      };
    },

    // Inspection functions
    getProject: async (projectId) => {
      return getProject(projectId);
    },

    getAllProjects: async () => {
      return getAllProjects();
    },

    getProjectMedia: async (projectId) => {
      return getProjectMediaIds(projectId);
    },

    getAllMedia: async () => {
      return getAllMedia();
    },

    getDBStats: async () => {
      return getDBStats();
    },

    getSnapshotStats: (snapshot) => {
      return getSnapshotStats(snapshot);
    },

    // Utility functions
    createSnapshot: (project) => {
      return createSnapshotFromProject(project);
    },

    parseJson: (json) => {
      return JSON.parse(json);
    },

    // Fixture functions
    generateFixture: async (type, options) => {
      const { generateFixture } = await import(
        '@/features/project-bundle/services/test-fixtures'
      );
      return generateFixture(type, options);
    },

    createFixtureProject: async (type, options) => {
      const { generateFixture } = await import(
        '@/features/project-bundle/services/test-fixtures'
      );
      const { project } = generateFixture(type, options);
      await createProject(project);
      return project;
    },

    listFixtures: async () => {
      const { getAvailableFixtures } = await import(
        '@/features/project-bundle/services/test-fixtures'
      );
      return getAvailableFixtures();
    },

    // Playback control (for debugging)
    seekTo: async (frame) => {
      const { usePlaybackStore } = await import('@/shared/state/playback');
      usePlaybackStore.getState().setCurrentFrame(frame);
    },
    play: async () => {
      const { usePlaybackStore } = await import('@/shared/state/playback');
      usePlaybackStore.getState().play();
    },
    pause: async () => {
      const { usePlaybackStore } = await import('@/shared/state/playback');
      usePlaybackStore.getState().pause();
    },

    // Timeline item inspection
    getItemsAtFrame: async (frame: number) => {
      const { useItemsStore } = await import('@/features/timeline/stores/items-store');
      const state = useItemsStore.getState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];
      for (const [trackId, trackItems] of Object.entries(state.itemsByTrackId)) {
        if (!trackItems) continue;
        for (const item of trackItems) {
          const end = item.from + item.durationInFrames;
          if (frame >= item.from && frame < end) {
            results.push({
              id: item.id.substring(0, 8),
              type: item.type,
              from: item.from,
              dur: item.durationInFrames,
              end,
              speed: item.speed ?? 1,
              trackId: trackId.substring(0, 8),
              label: ('label' in item ? item.label : undefined),
            });
          }
        }
      }
      return results;
    },
    getUpcomingItems: async (frame: number, lookahead: number) => {
      const { useItemsStore } = await import('@/features/timeline/stores/items-store');
      const state = useItemsStore.getState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];
      for (const [trackId, trackItems] of Object.entries(state.itemsByTrackId)) {
        if (!trackItems) continue;
        for (const item of trackItems) {
          if (item.from > frame && item.from <= frame + lookahead) {
            results.push({
              id: item.id.substring(0, 8),
              type: item.type,
              from: item.from,
              dur: item.durationInFrames,
              speed: item.speed ?? 1,
              trackId: trackId.substring(0, 8),
              label: ('label' in item ? item.label : undefined),
            });
          }
        }
      }
      return results;
    },

    // Version info
    version: '1.0.0',
  };
}

/**
 * Initialize debug utilities in development mode
 */
export function initializeDebugUtils(): void {
  if (import.meta.env.DEV) {
    const api = createDebugAPI();
    // Extend window type
    (window as unknown as { __DEBUG__: ProjectDebugAPI }).__DEBUG__ = api;
  }
}

// Type declaration for global window object
declare global {
  interface Window {
    __DEBUG__?: ProjectDebugAPI;
  }
}

