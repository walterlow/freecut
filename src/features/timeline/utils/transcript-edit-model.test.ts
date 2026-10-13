import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { MediaTranscript } from '@/types/storage'
import {
  buildRemovalRangesByMediaId,
  buildTranscriptTokens,
  findActiveTokenIndex,
  getSelectedTokenSlice,
} from './transcript-edit-model'

function makeItem(
  overrides: Partial<TimelineItem> & { id: string; mediaId: string },
): TimelineItem {
  return {
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 300,
    sourceStart: 0,
    sourceFps: 30,
    speed: 1,
    src: 'blob:test',
    ...overrides,
  } as TimelineItem
}

function makeTranscript(
  mediaId: string,
  words: Array<{ text: string; start: number; end: number }>,
): MediaTranscript {
  return {
    id: mediaId,
    mediaId,
    model: 'whisper-base',
    quantization: 'q8',
    text: words.map((w) => w.text).join(' '),
    segments: [{ text: words.map((w) => w.text).join(' '), start: 0, end: 10, words }],
    createdAt: 0,
    updatedAt: 0,
  }
}

const FPS = 30

describe('buildTranscriptTokens', () => {
  it('maps words to timeline frames in document order', () => {
    const item = makeItem({ id: 'a', mediaId: 'm1' })
    const transcript = makeTranscript('m1', [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'um', start: 0.5, end: 1.0 },
      { text: 'world', start: 1.0, end: 1.5 },
    ])

    const tokens = buildTranscriptTokens([item], { m1: transcript }, FPS)

    expect(tokens.map((t) => t.text)).toEqual(['hello', 'um', 'world'])
    expect(tokens[0]).toMatchObject({ startFrame: 0, endFrame: 15, itemId: 'a', mediaId: 'm1' })
    expect(tokens[1]).toMatchObject({ startFrame: 15, endFrame: 30 })
    expect(tokens[2]).toMatchObject({ startFrame: 30, endFrame: 45 })
  })

  it('drops words outside a trimmed clip source span', () => {
    // Clip trimmed to source seconds [1, 3].
    const item = makeItem({ id: 'a', mediaId: 'm1', sourceStart: 30, durationInFrames: 60 })
    const transcript = makeTranscript('m1', [
      { text: 'before', start: 0.0, end: 0.5 },
      { text: 'inside', start: 1.5, end: 2.0 },
      { text: 'after', start: 3.5, end: 4.0 },
    ])

    const tokens = buildTranscriptTokens([item], { m1: transcript }, FPS)
    expect(tokens.map((t) => t.text)).toEqual(['inside'])
  })

  it('skips items without a transcript or mediaId', () => {
    const withTranscript = makeItem({ id: 'a', mediaId: 'm1' })
    const noTranscript = makeItem({ id: 'b', mediaId: 'm2' })
    const transcript = makeTranscript('m1', [{ text: 'only', start: 0, end: 0.5 }])

    const tokens = buildTranscriptTokens([withTranscript, noTranscript], { m1: transcript }, FPS)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.itemId).toBe('a')
  })

  it('skips reversed clips because source transcript order no longer matches playback', () => {
    const item = makeItem({ id: 'reversed', mediaId: 'm1', isReversed: true })
    const transcript = makeTranscript('m1', [{ text: 'backwards', start: 0, end: 0.5 }])

    expect(buildTranscriptTokens([item], { m1: transcript }, FPS)).toEqual([])
  })

  it('does not duplicate words for a linked video + audio pair', () => {
    // Same media, same source span (a linked companion) — words appear once.
    const video = makeItem({ id: 'v', type: 'video', mediaId: 'm1' })
    const audio = makeItem({ id: 'a', type: 'audio', mediaId: 'm1' })
    const transcript = makeTranscript('m1', [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1.0 },
    ])

    const tokens = buildTranscriptTokens([video, audio], { m1: transcript }, FPS)
    expect(tokens.map((t) => t.text)).toEqual(['hello', 'world'])
    // Kept the video item.
    expect(tokens.every((t) => t.itemId === 'v')).toBe(true)
  })

  it('dedupes a linked pair even when source spans differ (audio frame base)', () => {
    // Same timeline range, but the audio companion stores its source frames in a
    // different base (e.g. samples), so its source span doesn't match the video.
    // Timeline-range dedup must still drop it.
    const video = makeItem({
      id: 'v',
      type: 'video',
      mediaId: 'm1',
      from: 0,
      durationInFrames: 300,
    })
    const audio = makeItem({
      id: 'a',
      type: 'audio',
      mediaId: 'm1',
      from: 0,
      durationInFrames: 300,
      sourceStart: 480000,
      sourceFps: 48000,
    })
    const transcript = makeTranscript('m1', [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1.0 },
    ])

    const tokens = buildTranscriptTokens([video, audio], { m1: transcript }, FPS)
    expect(tokens.map((t) => t.text)).toEqual(['hello', 'world'])
    expect(tokens.every((t) => t.itemId === 'v')).toBe(true)
  })

  it('collapses identical, identically-timed tokens from different media', () => {
    // Same footage imported as two separate media (different mediaIds) stacked at
    // the same spot escapes per-media dedup, so the token-level net must catch it.
    const a = makeItem({ id: 'a', type: 'video', mediaId: 'm1', from: 0, durationInFrames: 300 })
    const b = makeItem({ id: 'b', type: 'audio', mediaId: 'm2', from: 0, durationInFrames: 300 })
    const words = [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1.0 },
    ]

    const tokens = buildTranscriptTokens(
      [a, b],
      { m1: makeTranscript('m1', words), m2: makeTranscript('m2', words) },
      FPS,
    )
    expect(tokens.map((t) => t.text)).toEqual(['hello', 'world'])
  })

  it('keeps distinct trims of the same media', () => {
    // Two non-overlapping source spans of one media → both contribute words.
    const first = makeItem({
      id: 'a',
      mediaId: 'm1',
      from: 0,
      sourceStart: 0,
      durationInFrames: 30,
    })
    const second = makeItem({
      id: 'b',
      mediaId: 'm1',
      from: 120,
      sourceStart: 150,
      durationInFrames: 30,
    })
    const transcript = makeTranscript('m1', [
      { text: 'early', start: 0.2, end: 0.6 },
      { text: 'later', start: 5.2, end: 5.6 },
    ])

    const tokens = buildTranscriptTokens([first, second], { m1: transcript }, FPS)
    expect(tokens.map((t) => t.text)).toEqual(['early', 'later'])
    expect(tokens.map((t) => t.itemId)).toEqual(['a', 'b'])
  })

  it('orders tokens across clips by timeline frame', () => {
    const first = makeItem({ id: 'a', mediaId: 'm1', from: 0, durationInFrames: 60 })
    const second = makeItem({ id: 'b', mediaId: 'm2', from: 120, durationInFrames: 60 })
    const tokens = buildTranscriptTokens(
      [second, first],
      {
        m1: makeTranscript('m1', [{ text: 'one', start: 0, end: 0.5 }]),
        m2: makeTranscript('m2', [{ text: 'two', start: 0, end: 0.5 }]),
      },
      FPS,
    )
    expect(tokens.map((t) => t.text)).toEqual(['one', 'two'])
  })
})

describe('findActiveTokenIndex', () => {
  const tokens = buildTranscriptTokens(
    [makeItem({ id: 'a', mediaId: 'm1' })],
    {
      m1: makeTranscript('m1', [
        { text: 'hello', start: 0, end: 0.5 },
        { text: 'world', start: 0.5, end: 1.0 },
      ]),
    },
    FPS,
  )

  it('returns the word under the playhead', () => {
    expect(findActiveTokenIndex(tokens, 5)).toBe(0)
    expect(findActiveTokenIndex(tokens, 20)).toBe(1)
  })

  it('returns -1 past the end', () => {
    expect(findActiveTokenIndex(tokens, 9999)).toBe(-1)
  })
})

describe('buildRemovalRangesByMediaId', () => {
  it('merges a contiguous run within one clip into a single span', () => {
    const tokens = buildTranscriptTokens(
      [makeItem({ id: 'a', mediaId: 'm1' })],
      {
        m1: makeTranscript('m1', [
          { text: 'a', start: 0.0, end: 0.5 },
          { text: 'b', start: 0.5, end: 1.0 },
          { text: 'c', start: 1.0, end: 1.5 },
        ]),
      },
      FPS,
    )
    const ranges = buildRemovalRangesByMediaId(tokens)
    expect(ranges).toEqual({ m1: [{ start: 0.0, end: 1.5 }] })
  })

  it('produces one range per clip when selection spans clips', () => {
    const tokens = buildTranscriptTokens(
      [
        makeItem({ id: 'a', mediaId: 'm1', from: 0, durationInFrames: 60 }),
        makeItem({ id: 'b', mediaId: 'm2', from: 120, durationInFrames: 60 }),
      ],
      {
        m1: makeTranscript('m1', [{ text: 'one', start: 0, end: 0.5 }]),
        m2: makeTranscript('m2', [{ text: 'two', start: 0, end: 0.5 }]),
      },
      FPS,
    )
    const ranges = buildRemovalRangesByMediaId(tokens)
    expect(ranges).toEqual({
      m1: [{ start: 0, end: 0.5 }],
      m2: [{ start: 0, end: 0.5 }],
    })
  })

  it('returns empty for no selection', () => {
    expect(buildRemovalRangesByMediaId([])).toEqual({})
  })
})

describe('getSelectedTokenSlice', () => {
  const tokens = buildTranscriptTokens(
    [makeItem({ id: 'a', mediaId: 'm1' })],
    {
      m1: makeTranscript('m1', [
        { text: 'a', start: 0.0, end: 0.5 },
        { text: 'b', start: 0.5, end: 1.0 },
        { text: 'c', start: 1.0, end: 1.5 },
      ]),
    },
    FPS,
  )

  it('returns an inclusive slice regardless of anchor/focus order', () => {
    expect(getSelectedTokenSlice(tokens, 2, 0).map((t) => t.text)).toEqual(['a', 'b', 'c'])
    expect(getSelectedTokenSlice(tokens, 1, 1).map((t) => t.text)).toEqual(['b'])
  })

  it('returns empty when unset', () => {
    expect(getSelectedTokenSlice(tokens, -1, 2)).toEqual([])
  })
})
