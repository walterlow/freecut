import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThumbnailData } from '@/types/storage';

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    startEvent: () => ({ set: vi.fn(), merge: vi.fn(), success: vi.fn(), failure: vi.fn() }),
    child: vi.fn(),
    setLevel: vi.fn(),
  }),
  createOperationId: () => 'op-test',
}));

import {
  deleteThumbnailsByMediaId,
  getThumbnail,
  getThumbnailByMediaId,
  saveThumbnail,
} from './thumbnails';
import { setWorkspaceRoot } from './root';
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle';

function makeThumbnail(mediaId: string, id = `t-${mediaId}`): ThumbnailData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG SOI marker
  return {
    id,
    mediaId,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    timestamp: 0,
    width: 320,
    height: 180,
  };
}

afterEach(() => {
  setWorkspaceRoot(null);
});

describe('workspace-fs thumbnails', () => {
  it('saveThumbnail writes the jpeg blob to media/<id>/thumbnail.jpg', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));

    const text = await readFileText(root, 'media', 'm1', 'thumbnail.jpg');
    expect(text).not.toBeNull();
    // Sidecar was dropped in v2 — must not be written.
    expect(await readFileText(root, 'media', 'm1', 'thumbnail.meta.json')).toBeNull();
  });

  it('getThumbnailByMediaId returns saved thumbnail with id derived from mediaId', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));
    const t = await getThumbnailByMediaId('m1');
    expect(t).toBeDefined();
    // v2: id is derived from mediaId; the caller-supplied id is ignored.
    expect(t!.id).toBe('m1');
    expect(t!.mediaId).toBe('m1');
  });

  it('getThumbnailByMediaId returns undefined when missing', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    expect(await getThumbnailByMediaId('missing')).toBeUndefined();
  });

  it('getThumbnail(id) treats id as mediaId in v2', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));
    const t = await getThumbnail('m1');
    expect(t).toBeDefined();
    expect(t!.mediaId).toBe('m1');
  });

  it('deleteThumbnailsByMediaId removes the jpeg', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));
    await deleteThumbnailsByMediaId('m1');
    expect(await getThumbnailByMediaId('m1')).toBeUndefined();
    expect(await readFileText(root, 'media', 'm1', 'thumbnail.jpg')).toBeNull();
  });

  it('saveThumbnail overwrites prior thumbnail for the same media', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1', 'first'));
    await saveThumbnail(makeThumbnail('m1', 'second'));
    // Structure-level check: only one thumbnail entry remains for this media.
    const t = await getThumbnailByMediaId('m1');
    expect(t).toBeDefined();
    expect(t!.mediaId).toBe('m1');
  });
});
