import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem } from '@/types/timeline'
import type { StudioAudioSourceMetadata } from '@/types/studio-audio'
import { collectStudioAudioCredits, formatYouTubeStudioAudioCredits } from './studio-audio-credits'

const source: StudioAudioSourceMetadata = {
  provider: 'freesound',
  soundId: 100,
  title: 'Wooden door close',
  creator: 'field-recordist',
  sourceUrl: 'https://freesound.org/s/100/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  licenseCode: 'cc-by',
  retrievedAt: '2026-07-10T00:00:00.000Z',
  sourceKind: 'preview',
  reason: 'A door closes in the narration.',
  confidence: 0.92,
  approval: 'approved',
  locked: true,
}

function item(id: string, from: number): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'sfx',
    from,
    durationInFrames: 30,
    label: source.title,
    src: 'blob:door',
    studioAudioSource: source,
  }
}

describe('studio audio credits', () => {
  it('deduplicates a reused recording and preserves every timestamp', () => {
    const credits = collectStudioAudioCredits([item('a', 30), item('b', 90)], 'project-1', 30)
    expect(credits).toHaveLength(1)
    expect(credits[0]?.usedAtSeconds).toEqual([1, 3])
  })

  it('formats complete YouTube attribution text', () => {
    const text = formatYouTubeStudioAudioCredits(
      collectStudioAudioCredits([item('a', 30)], 'project-1', 30),
    )
    expect(text).toContain('"Wooden door close" by field-recordist')
    expect(text).toContain('Source: https://freesound.org/s/100/')
    expect(text).toContain('Used at: 0:01')
  })
})
