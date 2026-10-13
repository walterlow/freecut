import { describe, expect, it } from 'vite-plus/test'
import { resolveWhisperWordTimings } from './whisper-word-timings'

describe('resolveWhisperWordTimings', () => {
  it('preserves fully timestamped words', () => {
    expect(resolveWhisperWordTimings([{ text: 'hello', timestamp: [1, 1.4] }], 10, 30)).toEqual([
      { text: 'hello', start: 11, end: 11.4 },
    ])
  })

  it('preserves an open-ended final word', () => {
    expect(
      resolveWhisperWordTimings(
        [
          { text: '柔', timestamp: [4, 4.3] },
          { text: '眠', timestamp: [4.3, null] },
        ],
        118,
        12,
      ),
    ).toEqual([
      { text: '柔', start: 122, end: 122.3 },
      { text: '眠', start: 122.3, end: 122.8 },
    ])
  })

  it('uses the next known start for a missing end timestamp', () => {
    expect(
      resolveWhisperWordTimings(
        [
          { text: 'one', timestamp: [1, null] },
          { text: 'two', timestamp: [1.6, 2] },
        ],
        0,
        10,
      )[0],
    ).toEqual({ text: 'one', start: 1, end: 1.6 })
  })

  it('preserves a fully open final word at the chunk boundary', () => {
    expect(
      resolveWhisperWordTimings(
        [
          { text: 'before', timestamp: [11.5, 12] },
          { text: 'boundary', timestamp: [null, null] },
        ],
        118,
        12,
      ),
    ).toEqual([
      { text: 'before', start: 129.5, end: 130 },
      { text: 'boundary', start: 129.99, end: 130 },
    ])
  })
})
