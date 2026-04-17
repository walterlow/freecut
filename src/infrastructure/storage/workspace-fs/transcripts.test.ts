import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaTranscript } from '@/types/storage';

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
  deleteTranscript,
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
} from './transcripts';
import { setWorkspaceRoot } from './root';
import { asHandle, createRoot } from './__tests__/in-memory-handle';

function makeTranscript(mediaId: string): MediaTranscript {
  return {
    mediaId,
    model: 'whisper-tiny',
    quantization: 'q4',
    language: 'en',
    segments: [{ id: 0, start: 0, end: 1, text: 'hello' }],
    createdAt: 0,
  } as unknown as MediaTranscript;
}

afterEach(() => setWorkspaceRoot(null));

describe('workspace-fs transcripts', () => {
  it('saveTranscript then getTranscript round-trips', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveTranscript(makeTranscript('m1'));
    const t = await getTranscript('m1');
    expect(t!.mediaId).toBe('m1');
    expect(t!.segments[0]!.text).toBe('hello');
  });

  it('getTranscript returns undefined when missing', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    expect(await getTranscript('missing')).toBeUndefined();
  });

  it('getTranscriptMediaIds returns only ids that have a transcript', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveTranscript(makeTranscript('m1'));
    await saveTranscript(makeTranscript('m3'));
    const ids = await getTranscriptMediaIds(['m1', 'm2', 'm3']);
    expect(ids).toEqual(new Set(['m1', 'm3']));
  });

  it('getTranscriptMediaIds returns empty set for empty input without I/O', async () => {
    setWorkspaceRoot(null); // verifies it short-circuits before requireWorkspaceRoot
    const ids = await getTranscriptMediaIds([]);
    expect(ids.size).toBe(0);
  });

  it('deleteTranscript removes the file', async () => {
    const root = createRoot();
    setWorkspaceRoot(asHandle(root));
    await saveTranscript(makeTranscript('m1'));
    await deleteTranscript('m1');
    expect(await getTranscript('m1')).toBeUndefined();
  });
});
