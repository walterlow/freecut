/**
 * Workspace folder bootstrap: run once after the user picks (or re-grants) a
 * workspace. Writes the marker file + README if they're missing.
 */

import { createLogger } from '@/shared/logging/logger';
import {
  CONTENT_DIR,
  MARKER_FILENAME,
  MEDIA_DIR,
  PROJECTS_DIR,
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

/**
 * Recursively remove stranded `*.tmp` files.
 *
 * `writeJsonAtomic` creates `{name}.tmp` and then `.move()`s it (or writes
 * the target and removes the tmp). A crash between the tmp-write and the
 * move leaves the tmp-file behind. They're harmless — consumers only
 * read the non-tmp name — but they accumulate over time and clutter the
 * workspace when a user browses it externally.
 *
 * We only sweep the three directories we own (projects/media/content).
 * Anything else in the workspace (user's own files) is left alone.
 */
async function sweepStrandedTmpFiles(
  root: FileSystemDirectoryHandle,
  dirNames: string[],
): Promise<number> {
  let removed = 0;

  async function recurse(dir: FileSystemDirectoryHandle): Promise<void> {
    // Collect entries first because we mutate the dir while iterating.
    const entries: { name: string; kind: 'file' | 'directory' }[] = [];
    for await (const entry of dir.values()) {
      entries.push({ name: entry.name, kind: entry.kind });
    }
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        try {
          const sub = await dir.getDirectoryHandle(entry.name, { create: false });
          await recurse(sub);
        } catch (error) {
          logger.debug('sweepStrandedTmpFiles: subdir skipped', { name: entry.name, error });
        }
        continue;
      }
      if (entry.name.endsWith('.tmp')) {
        try {
          await dir.removeEntry(entry.name);
          removed++;
        } catch (error) {
          logger.debug('sweepStrandedTmpFiles: remove failed', { name: entry.name, error });
        }
      }
    }
  }

  for (const name of dirNames) {
    try {
      const sub = await root.getDirectoryHandle(name, { create: false });
      await recurse(sub);
    } catch {
      // Directory missing (fresh workspace) — nothing to sweep.
    }
  }
  return removed;
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

  // Clean up any `.tmp` files stranded by a prior crash.
  try {
    const removed = await sweepStrandedTmpFiles(root, [
      PROJECTS_DIR,
      MEDIA_DIR,
      CONTENT_DIR,
    ]);
    if (removed > 0) {
      logger.info(`Swept ${removed} stranded .tmp file(s) from prior crash`);
    }
  } catch (error) {
    logger.warn('sweepStrandedTmpFiles failed', error);
  }
}
