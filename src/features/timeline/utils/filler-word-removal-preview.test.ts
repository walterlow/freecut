import type { MediaTranscript } from '@/types/storage'
import { detectFillerRangesFromTranscript } from './filler-word-removal-preview'

function transcript(words: Array<{ text: string; start: number; end: number }>): MediaTranscript {
  return {
    id: 'media-1',
    mediaId: 'media-1',
    model: 'whisper-small',
    quantization: 'hybrid',
    text: words.map((word) => word.text).join(' '),
    segments: [
      {
        text: words.map((word) => word.text).join(' '),
        start: words[0]?.start ?? 0,
        end: words.at(-1)?.end ?? 0,
        words,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('detectFillerRangesFromTranscript', () => {
  it('detects standalone fillers with small padding', () => {
    const ranges = detectFillerRangesFromTranscript(
      transcript([
        { text: 'So', start: 0, end: 0.2 },
        { text: 'um,', start: 0.3, end: 0.55 },
        { text: 'we', start: 0.7, end: 0.9 },
      ]),
    )

    expect(ranges).toEqual([{ start: 0.265, end: 0.5850000000000001, text: 'um,' }])
  })

  it('detects short phrase fillers', () => {
    const ranges = detectFillerRangesFromTranscript(
      transcript([
        { text: 'I', start: 0, end: 0.1 },
        { text: 'mean', start: 0.12, end: 0.3 },
        { text: 'this', start: 0.5, end: 0.8 },
      ]),
    )

    expect(ranges).toEqual([{ start: 0, end: 0.33499999999999996, text: 'I mean' }])
  })

  it('ignores long simple filler-like words to avoid cutting real speech', () => {
    const ranges = detectFillerRangesFromTranscript(
      transcript([{ text: 'umm', start: 1, end: 2.6 }]),
    )

    expect(ranges).toEqual([])
  })

  it('uses custom filler words and phrases', () => {
    const ranges = detectFillerRangesFromTranscript(
      transcript([
        { text: 'basically', start: 0.1, end: 0.4 },
        { text: 'right', start: 0.7, end: 0.85 },
        { text: 'now', start: 0.87, end: 1.05 },
      ]),
      {
        fillerWords: ['basically'],
        fillerPhrases: ['right now'],
        paddingMs: 0,
        maxSimpleFillerMs: 900,
        maxPhraseFillerMs: 1800,
      },
    )

    expect(ranges).toEqual([
      { start: 0.1, end: 0.4, text: 'basically' },
      { start: 0.7, end: 1.05, text: 'right now' },
    ])
  })
})
