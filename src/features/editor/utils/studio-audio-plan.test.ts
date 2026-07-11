import { describe, expect, it } from 'vite-plus/test'
import type { AudiobookSfxCue } from './audiobook-sfx'
import {
  buildStudioAudioSearchKeywords,
  mapAudiobookCuesToStudioAudioPlan,
} from './studio-audio-plan'

const cue: AudiobookSfxCue = {
  id: 'cue-1',
  label: 'Storm outside',
  prompt: 'cinematic rain and thunder',
  sourceText: 'Rain hammered the windows before a deep thunder roll.',
  reason: 'The narration explicitly establishes a storm.',
  role: 'ambience',
  startSeconds: 10,
  endSeconds: 18,
  mixVolumeDb: -8,
  guidanceScale: 3,
}

describe('studio audio plan', () => {
  it('creates restrained provider search keywords from the cue', () => {
    const keywords = buildStudioAudioSearchKeywords(cue)
    expect(keywords).toContain('storm')
    expect(keywords).toContain('rain')
    expect(keywords).toContain('ambience')
    expect(keywords.length).toBeLessThanOrEqual(10)
  })

  it('preserves timing, rationale, confidence and mix intent', () => {
    expect(mapAudiobookCuesToStudioAudioPlan([cue])[0]).toMatchObject({
      id: 'cue-1',
      startSeconds: 10,
      endSeconds: 18,
      category: 'ambience',
      suggestedVolumeDb: -8,
      confidence: 0.88,
      explanation: 'The narration explicitly establishes a storm.',
    })
  })
})
