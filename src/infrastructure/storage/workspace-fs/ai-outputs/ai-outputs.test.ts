import { afterEach, describe, expect, it, vi } from 'vitest';

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
  deleteAiOutput,
  getMediaIdsWithAiOutput,
  listAiOutputs,
  readAiOutput,
  writeAiOutput,
} from './io';
import { setWorkspaceRoot } from '../root';
import { asHandle, createRoot } from '../__tests__/in-memory-handle';

afterEach(() => setWorkspaceRoot(null));

describe('workspace-fs ai-outputs', () => {
  it('round-trips a captions envelope', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    const written = await writeAiOutput({
      mediaId: 'm1',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      params: { sampleIntervalSec: 2 },
      data: { sampleIntervalSec: 2, captions: [{ timeSec: 0, text: 'hello' }] },
    });
    expect(written.createdAt).toBeGreaterThan(0);
    expect(written.updatedAt).toBeGreaterThanOrEqual(written.createdAt);

    const loaded = await readAiOutput('m1', 'captions');
    expect(loaded?.data.captions[0]?.text).toBe('hello');
    expect(loaded?.service).toBe('lfm-captioning');
  });

  it('preserves createdAt across updates', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    const first = await writeAiOutput({
      mediaId: 'm1',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      data: { captions: [{ timeSec: 0, text: 'v1' }] },
    });

    await new Promise((r) => setTimeout(r, 2));
    const second = await writeAiOutput({
      mediaId: 'm1',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      data: { captions: [{ timeSec: 0, text: 'v2' }] },
    });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('readAiOutput returns undefined when missing', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    expect(await readAiOutput('missing', 'captions')).toBeUndefined();
  });

  it('deleteAiOutput removes the file', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    await writeAiOutput({
      mediaId: 'm1',
      kind: 'scenes',
      service: 'scene-detect',
      model: 'histogram',
      data: {
        method: 'histogram',
        sampleIntervalMs: 250,
        fps: 30,
        cuts: [],
      },
    });
    await deleteAiOutput('m1', 'scenes');
    expect(await readAiOutput('m1', 'scenes')).toBeUndefined();
  });

  it('listAiOutputs returns saved kinds', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    await writeAiOutput({
      mediaId: 'm1',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      data: { captions: [] },
    });
    await writeAiOutput({
      mediaId: 'm1',
      kind: 'scenes',
      service: 'scene-detect',
      model: 'histogram',
      data: {
        method: 'histogram',
        sampleIntervalMs: 250,
        fps: 30,
        cuts: [],
      },
    });

    const kinds = await listAiOutputs('m1');
    expect(new Set(kinds)).toEqual(new Set(['captions', 'scenes']));
  });

  it('getMediaIdsWithAiOutput filters to ids with output present', async () => {
    setWorkspaceRoot(asHandle(createRoot()));
    await writeAiOutput({
      mediaId: 'm1',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      data: { captions: [] },
    });
    await writeAiOutput({
      mediaId: 'm3',
      kind: 'captions',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      data: { captions: [] },
    });

    const ids = await getMediaIdsWithAiOutput(['m1', 'm2', 'm3'], 'captions');
    expect(ids).toEqual(new Set(['m1', 'm3']));
  });

  it('getMediaIdsWithAiOutput short-circuits on empty input', async () => {
    setWorkspaceRoot(null);
    const ids = await getMediaIdsWithAiOutput([], 'captions');
    expect(ids.size).toBe(0);
  });
});
