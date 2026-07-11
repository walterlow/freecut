import { describe, expect, it } from 'vitest'
import type { MediaTranscript } from '@/types/storage'
import { planPixabayBroll } from './pixabay-broll-plan'

const transcript: MediaTranscript = {
  id: 'narration',
  mediaId: 'narration',
  model: 'whisper-base',
  quantization: 'q8',
  text: 'A lighthouse watched the storm. At sunrise the harbor was safe.',
  segments: [
    { start: 0, end: 5, text: 'A lighthouse watched the storm.' },
    { start: 5, end: 10, text: 'At sunrise the harbor was safe.' },
  ],
  createdAt: 0,
  updatedAt: 0,
}

describe('planPixabayBroll', () => {
  it('creates timed, visual search beats from narration', () => {
    const beats = planPixabayBroll(transcript, { maxBeatSeconds: 6 })
    expect(beats).toHaveLength(2)
    expect(beats[0]).toMatchObject({ startSeconds: 0, endSeconds: 5 })
    expect(beats[0]?.query).toContain('lighthouse')
    expect(beats[1]?.query).toContain('sunrise')
  })
})
