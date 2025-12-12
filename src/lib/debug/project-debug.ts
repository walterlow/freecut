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
} from '@/lib/storage/indexeddb';

/**
 * Debug API interface
 */
export interface ProjectDebugAPI {
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
      console.log(`[DEBUG] Exporting project: ${projectId}`);
      const snapshot = await exportProjectJson(projectId, options);
      console.log(`[DEBUG] Export complete:`, getSnapshotStats(snapshot));
      return snapshot;
    },

    exportProjectString: async (projectId, options) => {
      console.log(`[DEBUG] Exporting project as string: ${projectId}`);
      return exportProjectJsonString(projectId, options);
    },

    downloadProject: async (projectId, options) => {
      console.log(`[DEBUG] Downloading project: ${projectId}`);
      await downloadProjectJson(projectId, options);
      console.log(`[DEBUG] Download triggered`);
    },

    copyProjectToClipboard: async (projectId, options) => {
      console.log(`[DEBUG] Copying project to clipboard: ${projectId}`);
      await copyProjectToClipboard(projectId, options);
      console.log(`[DEBUG] Copied to clipboard`);
    },

    // Import functions
    importFromJson: async (json, options) => {
      console.log(`[DEBUG] Importing project from JSON`);
      const result = await importProjectFromJsonString(json, options);
      console.log(`[DEBUG] Import complete:`, {
        projectId: result.project.id,
        matched: result.matchedMedia.length,
        unmatched: result.unmatchedMedia.length,
        warnings: result.warnings,
      });
      return result.project;
    },

    importFromClipboard: async (options) => {
      console.log(`[DEBUG] Importing project from clipboard`);
      const result = await importProjectFromClipboard(options);
      console.log(`[DEBUG] Import complete:`, {
        projectId: result.project.id,
        matched: result.matchedMedia.length,
        unmatched: result.unmatchedMedia.length,
      });
      return result.project;
    },

    importFromFile: async (options) => {
      console.log(`[DEBUG] Opening file picker for import`);
      const result = await showImportFilePicker(options);
      if (result) {
        console.log(`[DEBUG] Import complete:`, {
          projectId: result.project.id,
          matched: result.matchedMedia.length,
          unmatched: result.unmatchedMedia.length,
        });
        return result.project;
      }
      console.log(`[DEBUG] Import cancelled`);
      return null;
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
      console.log(`[DEBUG] Generating fixture: ${type}`);
      const result = generateFixture(type, options);
      console.log(`[DEBUG] Fixture generated:`, {
        tracks: result.project.timeline?.tracks.length ?? 0,
        items: result.project.timeline?.items.length ?? 0,
      });
      return result;
    },

    createFixtureProject: async (type, options) => {
      const { generateFixture } = await import(
        '@/features/project-bundle/services/test-fixtures'
      );
      const { createProject } = await import('@/lib/storage/indexeddb');

      console.log(`[DEBUG] Creating fixture project: ${type}`);
      const { project } = generateFixture(type, options);
      await createProject(project);
      console.log(`[DEBUG] Fixture project created: ${project.id}`);
      return project;
    },

    listFixtures: async () => {
      const { getAvailableFixtures } = await import(
        '@/features/project-bundle/services/test-fixtures'
      );
      return getAvailableFixtures();
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

    console.log(
      '%c[FreeCut Debug] Debug utilities available at window.__DEBUG__',
      'color: #00b894; font-weight: bold;'
    );
    console.log(
      '%cAvailable functions:',
      'color: #6c5ce7;',
      Object.keys(api).filter((k) => typeof api[k as keyof ProjectDebugAPI] === 'function')
    );
    console.log(
      '%cExample usage:',
      'color: #fdcb6e;',
      `
  // Export current project
  const snapshot = await __DEBUG__.exportProject('project-id');

  // Download as file
  await __DEBUG__.downloadProject('project-id');

  // Copy to clipboard
  await __DEBUG__.copyProjectToClipboard('project-id');

  // Import from clipboard
  const project = await __DEBUG__.importFromClipboard();

  // Validate JSON
  const result = await __DEBUG__.validateSnapshot(jsonData);

  // Get DB stats
  const stats = await __DEBUG__.getDBStats();

  // Generate test fixtures
  const fixtures = await __DEBUG__.listFixtures();
  const { project, snapshot } = await __DEBUG__.generateFixture('complex');
  const newProject = await __DEBUG__.createFixtureProject('multi-track');
`
    );
  }
}

// Type declaration for global window object
declare global {
  interface Window {
    __DEBUG__?: ProjectDebugAPI;
  }
}
