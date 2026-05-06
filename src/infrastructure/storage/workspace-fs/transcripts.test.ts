import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'

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
}))

import {
  deleteTranscript,
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
} from './transcripts'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot } from './__tests__/in-memory-handle'
import { writeJsonAtomic } from './fs-primitives'
import { legacyTranscriptPath, aiOutputPath } from './paths'

function makeTranscript(mediaId: string): MediaTranscript {
  return {
    mediaId,
    model: 'whisper-tiny',
    quantization: 'q4',
    language: 'en',
    segments: [{ id: 0, start: 0, end: 1, text: 'hello' }],
    createdAt: 0,
  } as unknown as MediaTranscript
}

afterEach(() => setWorkspaceRoot(null))

describe('workspace-fs transcripts', () => {
  it('saveTranscript then getTranscript round-trips', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveTranscript(makeTranscript('m1'))
    const t = await getTranscript('m1')
    expect(t!.mediaId).toBe('m1')
    expect(t!.segments[0]!.text).toBe('hello')
  })

  it('getTranscript returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getTranscript('missing')).toBeUndefined()
  })

  it('getTranscriptMediaIds returns only ids that have a transcript', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveTranscript(makeTranscript('m1'))
    await saveTranscript(makeTranscript('m3'))
    const ids = await getTranscriptMediaIds(['m1', 'm2', 'm3'])
    expect(ids).toEqual(new Set(['m1', 'm3']))
  })

  it('getTranscriptMediaIds returns empty set for empty input without I/O', async () => {
    setWorkspaceRoot(null) // verifies it short-circuits before requireWorkspaceRoot
    const ids = await getTranscriptMediaIds([])
    expect(ids.size).toBe(0)
  })

  it('deleteTranscript removes the file', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveTranscript(makeTranscript('m1'))
    await deleteTranscript('m1')
    expect(await getTranscript('m1')).toBeUndefined()
  })

  it('reads a legacy cache/transcript.json written before the ai/ migration', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await writeJsonAtomic(
      asHandle(root),
      legacyTranscriptPath('legacy-id'),
      makeTranscript('legacy-id'),
    )

    const loaded = await getTranscript('legacy-id')
    expect(loaded?.mediaId).toBe('legacy-id')
    expect(loaded?.segments[0]?.text).toBe('hello')
  })

  it('saveTranscript migrates legacy path to ai/ envelope', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await writeJsonAtomic(asHandle(root), legacyTranscriptPath('m2'), makeTranscript('m2'))

    // Round-trip through save rewrites to the new path.
    await saveTranscript(makeTranscript('m2'))

    // Allow the fire-and-forget legacy cleanup to settle.
    await Promise.resolve()

    const { readJson } = await import('./fs-primitives')
    const legacy = await readJson(asHandle(root), legacyTranscriptPath('m2'))
    expect(legacy).toBeNull()

    const envelope = await readJson(asHandle(root), aiOutputPath('m2', 'transcript'))
    expect(envelope).toBeTruthy()
  })
})
