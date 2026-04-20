import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemDir } from './__tests__/in-memory-handle';
import { setWorkspaceRoot } from './root';
import { sweepWorkspaceOrphans } from './orphan-sweep';
import { writeBlob } from './fs-primitives';

const asHandle = (m: MemDir) => m as unknown as FileSystemDirectoryHandle;

async function createDir(root: MemDir, path: string[]): Promise<MemDir> {
  let dir = root;
  for (const p of path) {
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  return dir;
}

async function createLiveMedia(root: MemDir, mediaId: string): Promise<void> {
  await createDir(root, ['media', mediaId]);
}

beforeEach(() => setWorkspaceRoot(null));
afterEach(() => setWorkspaceRoot(null));

describe('sweepWorkspaceOrphans', () => {
  it('returns zero orphans for an empty workspace', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));

    const report = await sweepWorkspaceOrphans();

    expect(report.totalRemoved).toBe(0);
    expect(report.liveMediaCount).toBe(0);
  });

  it('detects orphaned filmstrip directories', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    await createLiveMedia(root, 'alive-1');
    await createDir(root, ['filmstrips', 'alive-1']); // kept
    await createDir(root, ['filmstrips', 'orphan-a']); // gone
    await createDir(root, ['filmstrips', 'orphan-b']); // gone

    const report = await sweepWorkspaceOrphans({ dryRun: true });

    expect(report.filmstripOrphans.sort()).toEqual(['orphan-a', 'orphan-b']);
    expect(report.totalRemoved).toBe(2);
    // dryRun: nothing actually removed
    const entries: string[] = [];
    for await (const e of (await root.getDirectoryHandle('filmstrips')).values()) {
      entries.push(e.name);
    }
    expect(entries.sort()).toEqual(['alive-1', 'orphan-a', 'orphan-b']);
  });

  it('removes orphaned filmstrip directories when not in dry-run', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    await createLiveMedia(root, 'alive-1');
    await createDir(root, ['filmstrips', 'alive-1']);
    await createDir(root, ['filmstrips', 'orphan-a']);

    await sweepWorkspaceOrphans();

    const entries: string[] = [];
    for await (const e of (await root.getDirectoryHandle('filmstrips')).values()) {
      entries.push(e.name);
    }
    expect(entries).toEqual(['alive-1']);
  });

  it('detects orphaned waveform-bin files stripped of extension', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    await createLiveMedia(root, 'alive-1');
    await writeBlob(asHandle(root), ['waveform-bin', 'alive-1.bin'], new Uint8Array([1]));
    await writeBlob(asHandle(root), ['waveform-bin', 'orphan-a.bin'], new Uint8Array([1]));
    await writeBlob(asHandle(root), ['waveform-bin', 'orphan-b.bin'], new Uint8Array([1]));

    const report = await sweepWorkspaceOrphans();

    expect(report.waveformBinOrphans.sort()).toEqual(['orphan-a.bin', 'orphan-b.bin']);
    const entries: string[] = [];
    for await (const e of (await root.getDirectoryHandle('waveform-bin')).values()) {
      entries.push(e.name);
    }
    expect(entries).toEqual(['alive-1.bin']);
  });

  it('detects orphaned preview-audio directories', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    await createLiveMedia(root, 'alive-1');
    await createDir(root, ['preview-audio', 'alive-1']);
    await createDir(root, ['preview-audio', 'orphan-a']);

    const report = await sweepWorkspaceOrphans();

    expect(report.previewAudioOrphans).toEqual(['orphan-a']);
  });

  it('ignores entries with unrecognized shapes (e.g. stray .bin in filmstrips)', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    // Filmstrips are expected to be directories per-media. A stray file is
    // not treated as a mediaId, just skipped.
    await writeBlob(asHandle(root), ['filmstrips', 'README.txt'], new Uint8Array([1]));

    const report = await sweepWorkspaceOrphans();

    expect(report.filmstripOrphans).toEqual([]);
  });

  it('reports totalRemoved across all three cache kinds', async () => {
    const root = new MemDir('ws');
    setWorkspaceRoot(asHandle(root));
    await createLiveMedia(root, 'alive-1');
    await createDir(root, ['filmstrips', 'orphan-a']);
    await createDir(root, ['preview-audio', 'orphan-b']);
    await writeBlob(asHandle(root), ['waveform-bin', 'orphan-c.bin'], new Uint8Array([1]));

    const report = await sweepWorkspaceOrphans();

    expect(report.totalRemoved).toBe(3);
    expect(report.liveMediaCount).toBe(1);
  });
});
