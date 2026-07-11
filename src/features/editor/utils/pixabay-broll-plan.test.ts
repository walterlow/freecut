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

  it('splits long narration into varied cinematic coverage', () => {
    const beats = planPixabayBroll(
      {
        ...transcript,
        segments: [
          {
            start: 0,
            end: 10,
            text: 'A lighthouse watched the storm while a ship crossed the dangerous harbor.',
          },
        ],
      },
      { maxBeatSeconds: 3, maxBeats: 8, coverageStyle: 'cinematic' },
    )

    expect(beats).toHaveLength(4)
    expect(beats.map((beat) => beat.endSeconds - beat.startSeconds)).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(beats[0]?.query).toContain('wide establishing')
    expect(beats[2]?.query).toContain('close up detail')
    expect(beats[3]?.query).toContain('macro texture')
  })
})
