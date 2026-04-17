/**
 * Workspace orphan sweeper.
 *
 * Scans the workspace-level mirror-cache directories (keyed by mediaId)
 * and removes entries whose mediaId is no longer present in `media/`.
 *
 * Why: the media-library-service inline cleanup handles the happy path
 * ("delete the last project using this media → wipe its caches"), but
 * can leave orphans behind if:
 *   - an inline cleanup call threw partway through
 *   - a prior app version didn't clean these dirs on delete
 *   - the user wiped a media-library entry manually on disk
 *
 * Usage:
 *   - Dev / debug: `window.__DEBUG__.cleanOrphans({ dryRun: true })`
 *     then `window.__DEBUG__.cleanOrphans()` to actually remove.
 *   - Later (UI): a "Clean up caches" button on the projects/settings
 *     screen can call `sweepWorkspaceOrphans()` and surface the report.
 *
 * Does NOT touch:
 *   - `projects/` — those are authoritative, not caches.
 *   - `.trash/` — trash has its own TTL sweep (see soft-delete).
 *   - `proxies/` — proxyKeys aren't mediaIds; reverse-mapping would need
 *     proxy-service cooperation. Tracked as follow-up.
 *   - `content/` — refcounted; stale content is handled by the refcount
 *     logic, and orphaned content blobs should be rare enough to GC
 *     separately.
 */

import { createLogger } from '@/shared/logging/logger';
import { requireWorkspaceRoot } from './root';
import {
  listDirectory,
  removeEntry,
} from './fs-primitives';
import {
  MEDIA_DIR,
  WORKSPACE_FILMSTRIPS_DIR,
  WORKSPACE_PREVIEW_AUDIO_DIR,
  WORKSPACE_WAVEFORM_BIN_DIR,
} from './paths';

const logger = createLogger('WorkspaceFS:OrphanSweep');

export interface OrphanSweepReport {
  liveMediaCount: number;
  filmstripOrphans: string[];
  previewAudioOrphans: string[];
  waveformBinOrphans: string[];
  /** Total entries that were (or would be, in dry-run) removed. */
  totalRemoved: number;
  /** Dry-run = report only, do not touch disk. */
  dryRun: boolean;
  durationMs: number;
}

export interface OrphanSweepOptions {
  dryRun?: boolean;
}

async function getLiveMediaIds(
  root: FileSystemDirectoryHandle,
): Promise<Set<string>> {
  const entries = await listDirectory(root, [MEDIA_DIR]);
  return new Set(
    entries.filter((e) => e.kind === 'directory').map((e) => e.name),
  );
}

async function findOrphansIn(
  root: FileSystemDirectoryHandle,
  dir: string,
  live: Set<string>,
  /** Extract the mediaId from an entry name. For directories, the name
   *  IS the mediaId. For files like `{mediaId}.bin`, strip the extension. */
  extract: (name: string, kind: 'file' | 'directory') => string | null,
): Promise<string[]> {
  const entries = await listDirectory(root, [dir]);
  const orphans: string[] = [];
  for (const entry of entries) {
    const mediaId = extract(entry.name, entry.kind);
    if (!mediaId) continue;
    if (!live.has(mediaId)) {
      orphans.push(entry.name);
    }
  }
  return orphans;
}

async function removeOrphansIn(
  root: FileSystemDirectoryHandle,
  dir: string,
  orphanNames: string[],
): Promise<void> {
  for (const name of orphanNames) {
    try {
      await removeEntry(root, [dir, name], { recursive: true });
    } catch (error) {
      logger.warn(`Failed to remove orphan ${dir}/${name}`, error);
    }
  }
}

export async function sweepWorkspaceOrphans(
  options: OrphanSweepOptions = {},
): Promise<OrphanSweepReport> {
  const dryRun = options.dryRun ?? false;
  const started = Date.now();
  const root = requireWorkspaceRoot();

  const live = await getLiveMediaIds(root);

  const [filmstripOrphans, previewAudioOrphans, waveformBinOrphans] = await Promise.all([
    // filmstrips/{mediaId}/
    findOrphansIn(root, WORKSPACE_FILMSTRIPS_DIR, live, (name, kind) =>
      kind === 'directory' ? name : null,
    ),
    // preview-audio/{mediaId}/
    findOrphansIn(root, WORKSPACE_PREVIEW_AUDIO_DIR, live, (name, kind) =>
      kind === 'directory' ? name : null,
    ),
    // waveform-bin/{mediaId}.bin
    findOrphansIn(root, WORKSPACE_WAVEFORM_BIN_DIR, live, (name, kind) => {
      if (kind !== 'file') return null;
      return name.endsWith('.bin') ? name.slice(0, -'.bin'.length) : null;
    }),
  ]);

  if (!dryRun) {
    await Promise.all([
      removeOrphansIn(root, WORKSPACE_FILMSTRIPS_DIR, filmstripOrphans),
      removeOrphansIn(root, WORKSPACE_PREVIEW_AUDIO_DIR, previewAudioOrphans),
      removeOrphansIn(root, WORKSPACE_WAVEFORM_BIN_DIR, waveformBinOrphans),
    ]);
  }

  const totalRemoved =
    filmstripOrphans.length +
    previewAudioOrphans.length +
    waveformBinOrphans.length;

  const report: OrphanSweepReport = {
    liveMediaCount: live.size,
    filmstripOrphans,
    previewAudioOrphans,
    waveformBinOrphans,
    totalRemoved,
    dryRun,
    durationMs: Date.now() - started,
  };

  if (totalRemoved > 0) {
    logger.info(
      `${dryRun ? 'Would remove' : 'Removed'} ${totalRemoved} orphan cache entries` +
        ` (${filmstripOrphans.length} filmstrip, ${previewAudioOrphans.length} preview-audio,` +
        ` ${waveformBinOrphans.length} waveform-bin)`,
    );
  } else {
    logger.info('No orphan cache entries found');
  }

  return report;
}
