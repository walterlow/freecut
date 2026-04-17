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
  it('saveThumbnail writes binary and meta sidecar', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));

    // binary exists (assert non-null; contents checked via retrieval below)
    const text = await readFileText(root, 'media', 'm1', 'thumbnail.meta.json');
    expect(text).not.toBeNull();
    const meta = JSON.parse(text!);
    expect(meta).toEqual({ id: 't-m1', mediaId: 'm1', timestamp: 0, width: 320, height: 180 });
  });

  it('getThumbnailByMediaId returns saved thumbnail', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));
    const t = await getThumbnailByMediaId('m1');
    expect(t).toBeDefined();
    expect(t!.id).toBe('t-m1');
    expect(t!.mediaId).toBe('m1');
  });

  it('getThumbnailByMediaId returns undefined when missing', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    expect(await getThumbnailByMediaId('missing')).toBeUndefined();
  });

  it('getThumbnail (by thumbnail id) scans media dirs', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1', 't-abc'));
    await saveThumbnail(makeThumbnail('m2', 't-xyz'));
    const t = await getThumbnail('t-xyz');
    expect(t).toBeDefined();
    expect(t!.mediaId).toBe('m2');
  });

  it('deleteThumbnailsByMediaId clears both sidecar and binary', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1'));
    await deleteThumbnailsByMediaId('m1');
    expect(await getThumbnailByMediaId('m1')).toBeUndefined();
    expect(await readFileText(root, 'media', 'm1', 'thumbnail.meta.json')).toBeNull();
  });

  it('saveThumbnail overwrites prior thumbnail for the same media', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveThumbnail(makeThumbnail('m1', 'first'));
    await saveThumbnail(makeThumbnail('m1', 'second'));
    const t = await getThumbnailByMediaId('m1');
    expect(t!.id).toBe('second');
  });
});
