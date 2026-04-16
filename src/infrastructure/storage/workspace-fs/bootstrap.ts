/**
 * Workspace folder bootstrap: run once after the user picks (or re-grants) a
 * workspace. Writes the marker file + README if they're missing.
 */

import { createLogger } from '@/shared/logging/logger';
import {
  MARKER_FILENAME,
  README_FILENAME,
  WORKSPACE_SCHEMA_VERSION,
} from './paths';
import { exists, writeBlob, writeJsonAtomic } from './fs-primitives';
import readmeTemplate from './README.template.md?raw';

const logger = createLogger('WorkspaceBootstrap');

export interface WorkspaceMarker {
  schemaVersion: string;
  createdAt: number;
  migratedFromLegacyAt?: number;
}

export async function bootstrapWorkspace(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  // README: only write when missing — never overwrite user edits.
  if (!(await exists(root, [README_FILENAME]))) {
    try {
      await writeBlob(root, [README_FILENAME], readmeTemplate);
    } catch (error) {
      logger.warn('Failed to write README.md', error);
    }
  }

  // Marker: write on first bootstrap so we can detect "this is a real
  // FreeCut workspace" and attach a schema version for future migrations.
  if (!(await exists(root, [MARKER_FILENAME]))) {
    const marker: WorkspaceMarker = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      createdAt: Date.now(),
    };
    try {
      await writeJsonAtomic(root, [MARKER_FILENAME], marker);
    } catch (error) {
      logger.warn('Failed to write workspace marker', error);
    }
  }
}
