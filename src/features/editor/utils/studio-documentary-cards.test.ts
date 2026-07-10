import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTranscriptCaptionCue } from '@/types/timeline'
import { planStudioDocumentaryCards } from './studio-documentary-cards'

function narration(cues: TimelineTranscriptCaptionCue[]): AudioItem {
  return {
    id: 'voice',
    trackId: 'a1',
    type: 'audio',
    from: 0,
    durationInFrames: 1800,
    label: 'Narration',
    src: 'blob:voice',
    mediaId: 'voice-media',
    sourceStart: 0,
    sourceEnd: 1800,
    sourceDuration: 1800,
    sourceFps: 30,
    transcriptCaptions: {
      type: 'transcript',
      mediaId: 'voice-media',
      enabled: true,
      updatedAt: 1,
      cues,
    },
  }
}

describe('studio documentary cards', () => {
  it('selects sparse dates, figures, and thesis statements from narration', () => {
    const cards = planStudioDocumentaryCards({
      fps: 30,
      narrationItem: narration([
        {
          id: 'a',
          startSeconds: 1,
          endSeconds: 3,
          text: 'With no money or connections, he began.',
        },
        {
          id: 'b',
          startSeconds: 15,
          endSeconds: 17,
          text: 'In 1926 the company changed its name.',
        },
        {
          id: 'c',
          startSeconds: 30,
          endSeconds: 32,
          text: 'It now produces 800,000 watches per year.',
        },
      ]),
    })

    expect(cards.map((card) => card.text)).toEqual([
      'WITH NO MONEY OR CONNECTIONS HE BEGAN',
      '1926',
      '800,000',
    ])
    expect(cards.map((card) => card.kind)).toEqual(['statement', 'date', 'stat'])
  })

  it('keeps cards spaced and respects the requested maximum', () => {
    const cards = planStudioDocumentaryCards({
      fps: 30,
      maxCards: 1,
      narrationItem: narration([
        { id: 'a', startSeconds: 1, endSeconds: 2, text: 'The secret business began in 1926.' },
        { id: 'b', startSeconds: 4, endSeconds: 5, text: 'It made 800,000 watches.' },
      ]),
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.text).toBe('1926')
  })
})
