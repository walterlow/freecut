import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  adoptCaptionsFromCache,
  deleteCaptions,
  getCaptionEmbeddings,
  getCaptionsByContentHash,
  getCaptionsEmbeddingsMeta,
  saveCaptionEmbeddings,
  saveCaptions,
} from './captions';
import { contentCaptionThumbRelPath } from './paths';
import { setWorkspaceRoot } from './root';
import { asHandle, createRoot } from './__tests__/in-memory-handle';
import { __resetKeyLocksForTesting } from './with-key-lock';

beforeEach(() => {
  setWorkspaceRoot(null);
  __resetKeyLocksForTesting();
});

afterEach(() => {
  setWorkspaceRoot(null);
  __resetKeyLocksForTesting();
});

describe('workspace-fs captions', () => {
  it('stores shared caption assets in separate cache variants per sample interval', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    const hash = 'a'.repeat(64);

    await saveCaptions({
      mediaId: 'm1',
      captions: [{ timeSec: 0, text: 'three-second' }],
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      sampleIntervalSec: 3,
      contentHash: hash,
    });
    await saveCaptionEmbeddings('m1', [Float32Array.from([1, 2])], 2, {
      contentHash: hash,
      sampleIntervalSec: 3,
    });
    const shortThumb = contentCaptionThumbRelPath(hash, 0, 3);

    await saveCaptions({
      mediaId: 'm2',
      captions: [{ timeSec: 0, text: 'ten-second' }],
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      sampleIntervalSec: 10,
      contentHash: hash,
    });
    await saveCaptionEmbeddings('m2', [Float32Array.from([3, 4])], 2, {
      contentHash: hash,
      sampleIntervalSec: 10,
    });
    const longThumb = contentCaptionThumbRelPath(hash, 0, 10);

    const shortCache = await getCaptionsByContentHash(hash, 3);
    const longCache = await getCaptionsByContentHash(hash, 10);
    const shortVectors = await getCaptionEmbeddings('m1', 2, 1, {
      contentHash: hash,
      sampleIntervalSec: 3,
    });
    const longVectors = await getCaptionEmbeddings('m2', 2, 1, {
      contentHash: hash,
      sampleIntervalSec: 10,
    });

    expect(shortCache?.data.captions[0]?.text).toBe('three-second');
    expect(longCache?.data.captions[0]?.text).toBe('ten-second');
    expect(shortThumb).toContain('/si-300/');
    expect(longThumb).toContain('/si-1000/');
    expect(shortThumb).not.toBe(longThumb);
    expect(Array.from(shortVectors?.[0] ?? [])).toEqual([1, 2]);
    expect(Array.from(longVectors?.[0] ?? [])).toEqual([3, 4]);
  });

  it('keeps other interval variants alive when deleting one shared caption cache entry', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    const hash = 'b'.repeat(64);

    await saveCaptions({
      mediaId: 'm1',
      captions: [{ timeSec: 0, text: 'three-second' }],
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      sampleIntervalSec: 3,
      contentHash: hash,
    });
    await saveCaptions({
      mediaId: 'm2',
      captions: [{ timeSec: 0, text: 'ten-second' }],
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      sampleIntervalSec: 10,
      contentHash: hash,
    });

    const adopted = await adoptCaptionsFromCache('m3', hash, 3);
    expect(adopted?.data.captions[0]?.text).toBe('three-second');
    expect((await getCaptionsEmbeddingsMeta('m3'))?.sampleIntervalSec).toBe(3);

    await deleteCaptions('m1');

    expect(await getCaptionsByContentHash(hash, 3)).toBeDefined();
    expect(await getCaptionsByContentHash(hash, 10)).toBeDefined();

    await deleteCaptions('m3');

    expect(await getCaptionsByContentHash(hash, 3)).toBeUndefined();
    expect(await getCaptionsByContentHash(hash, 10)).toBeDefined();
  });
});
