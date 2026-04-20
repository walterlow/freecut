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
  proxiesRoot,
} from './paths';
import { exists, listDirectory, readBlob, removeEntry, writeBlob, writeJsonAtomic } from './fs-primitives';
import { migrateWorkspaceV2 } from './migrate-workspace-v2';
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

const PROXY_KEY_TAG_PATTERN = /^[hof]-/;

/**
 * Rename any `content/proxies/{h|o|f}-*` folders to their un-tagged form.
 * Safe to call every bootstrap: returns 0 when nothing matches.
 *
 * Moves via copy-then-delete because FileSystemDirectoryHandle doesn't yet
 * expose a cross-browser rename. If both old and new names exist (e.g. a
 * partial prior run), the new name wins and the prefixed one is removed.
 */
async function stripProxyKeyPrefixes(
  root: FileSystemDirectoryHandle,
): Promise<number> {
  const entries = await listDirectory(root, proxiesRoot());
  let renamed = 0;
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    if (!PROXY_KEY_TAG_PATTERN.test(entry.name)) continue;

    const oldName = entry.name;
    const newName = oldName.slice(2);
    const oldDir = [...proxiesRoot(), oldName];
    const newDir = [...proxiesRoot(), newName];

    try {
      if (await exists(root, newDir)) {
        // New name already present — drop the prefixed copy and move on.
        await removeEntry(root, oldDir, { recursive: true });
        renamed++;
        continue;
      }

      // Read every file up front. Aborting on the first unreadable file
      // avoids a destructive half-move: we only delete oldDir once every
      // expected file has been successfully copied to newDir.
      const files = await listDirectory(root, oldDir);
      const filePayloads: Array<{ name: string; blob: Blob }> = [];
      let allReadable = true;
      for (const file of files) {
        if (file.kind !== 'file') continue;
        const blob = await readBlob(root, [...oldDir, file.name]).catch(() => null);
        if (!blob) {
          allReadable = false;
          break;
        }
        filePayloads.push({ name: file.name, blob });
      }
      if (!allReadable) {
        logger.warn(`stripProxyKeyPrefixes: aborting ${oldName} — unreadable file, leaving source intact`);
        continue;
      }

      let allWritten = true;
      const written: string[] = [];
      for (const payload of filePayloads) {
        try {
          await writeBlob(root, [...newDir, payload.name], payload.blob);
          written.push(payload.name);
        } catch (error) {
          logger.warn(`stripProxyKeyPrefixes: write failed for ${oldName}/${payload.name}`, error);
          allWritten = false;
          break;
        }
      }
      if (!allWritten) {
        // Roll back partial writes so we leave the new location empty and the
        // old directory untouched for a retry on next bootstrap.
        for (const name of written) {
          await removeEntry(root, [...newDir, name], { recursive: false }).catch(() => undefined);
        }
        continue;
      }

      await removeEntry(root, oldDir, { recursive: true });
      renamed++;
    } catch (error) {
      logger.warn(`stripProxyKeyPrefixes: failed to rename ${oldName}`, error);
    }
  }
  return renamed;
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
  } else {
    // Marker present — may need migration. Must run before any other
    // workspace read path in consumer code that would otherwise fail on
    // the old layout.
    try {
      const report = await migrateWorkspaceV2(root);
      if (report.ran) {
        logger.info('Workspace migration finished', {
          from: report.fromVersion,
          to: report.toVersion,
          filmstrips: report.filmstripMediaMoved,
          waveforms: report.waveformBinMoved,
          previewAudio: report.previewAudioMoved,
          proxies: report.proxiesMoved,
          thumbnailMetaRemoved: report.thumbnailMetaRemoved,
          projectThumbnailsFixed: report.projectThumbnailsFixed,
          errors: report.errors.length,
          durationMs: Math.round(report.durationMs),
        });
      }
    } catch (error) {
      logger.warn('Workspace migration failed', error);
    }
  }

  // One-off cleanup: proxy folders historically carried an `h-`/`o-`/`f-`
  // source-type tag. The tag carries no information the format's shape
  // doesn't already convey, so we strip it in place. Idempotent — runs
  // every bootstrap but is O(0) once no prefixed names remain.
  try {
    const renamed = await stripProxyKeyPrefixes(root);
    if (renamed > 0) {
      logger.info(`Stripped source-type prefix from ${renamed} proxy folder(s)`);
    }
  } catch (error) {
    logger.warn('stripProxyKeyPrefixes failed', error);
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
