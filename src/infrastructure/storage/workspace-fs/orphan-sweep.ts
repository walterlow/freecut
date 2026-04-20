/**
 * Workspace orphan sweeper.
 *
 * In v2 (see paths.ts schema notes), per-media caches (filmstrip, waveform,
 * preview-audio, etc.) live *inside* `media/<id>/cache/`. Removing a media
 * entry also removes its caches, so orphans are structurally impossible for
 * those caches.
 *
 * This sweep still exists as a hook for future orphan classes — currently
 * `content/proxies/<proxyKey>/` is content-fingerprint keyed and could
 * accumulate orphans if proxy-service cleanup is skipped. That reverse
 * mapping needs proxy-service cooperation and is tracked as follow-up.
 *
 * Usage:
 *   - Dev / debug: `window.__DEBUG__.cleanOrphans({ dryRun: true })`
 *     then `window.__DEBUG__.cleanOrphans()` to actually remove.
 *
 * Does NOT touch:
 *   - `projects/` — authoritative.
 *   - `.trash/` — separate TTL sweep.
 *   - `content/proxies/` — reverse-mapping TODO.
 *   - `content/<hash[0:2]>/` — refcounted, handled by refcount logic.
 */

import { createLogger } from '@/shared/logging/logger';
import { requireWorkspaceRoot } from './root';
import { listDirectory } from './fs-primitives';
import { MEDIA_DIR } from './paths';

const logger = createLogger('WorkspaceFS:OrphanSweep');

export interface OrphanSweepReport {
  liveMediaCount: number;
  /** Total entries that were (or would be, in dry-run) removed. */
  totalRemoved: number;
  /** Dry-run = report only, do not touch disk. */
  dryRun: boolean;
  durationMs: number;
}

export interface OrphanSweepOptions {
  dryRun?: boolean;
}

async function countLiveMedia(
  root: FileSystemDirectoryHandle,
): Promise<number> {
  const entries = await listDirectory(root, [MEDIA_DIR]);
  return entries.filter((e) => e.kind === 'directory').length;
}

export async function sweepWorkspaceOrphans(
  options: OrphanSweepOptions = {},
): Promise<OrphanSweepReport> {
  const dryRun = options.dryRun ?? false;
  const started = Date.now();
  const root = requireWorkspaceRoot();

  const liveMediaCount = await countLiveMedia(root);

  const report: OrphanSweepReport = {
    liveMediaCount,
    totalRemoved: 0,
    dryRun,
    durationMs: Date.now() - started,
  };

  logger.info('Orphan sweep: v2 layout has no orphaned per-media caches');
  return report;
}
