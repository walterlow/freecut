import { describe, expect, it } from 'vitest'
import type { MediaTranscript } from '@/types/storage'
import { getAudiobookSfxTimelineVolumeDb, planAudiobookSoundEffects } from './audiobook-sfx'

function transcript(text: string, segments: MediaTranscript['segments']): MediaTranscript {
  return {
    id: 'media-1',
    mediaId: 'media-1',
    model: 'whisper-tiny',
    quantization: 'q8',
    text,
    segments,
    createdAt: 1,
    updatedAt: 1,
  }
}

function hasNearbyAudibleCue(
  cues: ReturnType<typeof planAudiobookSoundEffects>,
  seconds: number,
): boolean {
  return cues.some((cue) => {
    if (cue.role === 'ambience') return false
    return cue.startSeconds <= seconds + 8 && cue.endSeconds >= seconds - 4
  })
}

describe('planAudiobookSoundEffects', () => {
  it('creates ordered sound-effect cues from narration keywords', () => {
    const cues = planAudiobookSoundEffects(
      transcript('The clock chimed. Rain hit the window. The old door opened.', [
        { text: 'The clock chimed.', start: 0, end: 2 },
        { text: 'Rain hit the window.', start: 7, end: 9 },
        { text: 'The old door opened.', start: 15, end: 17 },
      ]),
      { maxCues: 3, durationSeconds: 2, narrationDurationSeconds: 20 },
    )

    expect(cues.map((cue) => cue.label)).toEqual(['Clock', 'Storm', 'Door'])
    expect(cues.map((cue) => cue.role)).toEqual(['foreground', 'foreground', 'foreground'])
    expect(cues.map((cue) => cue.startSeconds)).toEqual([0, 7, 15])
    expect(cues.every((cue) => cue.prompt.includes('no speech'))).toBe(true)
    expect(cues.every((cue) => cue.prompt.includes('feature-film sound library quality'))).toBe(
      true,
    )
    expect(cues.every((cue) => cue.guidanceScale >= 5.8)).toBe(true)
  })

  it('falls back to ambience when no action keyword is found', () => {
    const cues = planAudiobookSoundEffects(
      transcript('She wondered whether tomorrow would feel different.', [
        {
          text: 'She wondered whether tomorrow would feel different.',
          start: 0,
          end: 5,
        },
      ]),
      { maxCues: 2, durationSeconds: 3, narrationDurationSeconds: 12 },
    )

    expect(cues).toHaveLength(1)
    expect(cues[0]?.label).toBe('Story ambience')
    expect(cues[0]?.role).toBe('ambience')
    expect(cues[0]?.mixVolumeDb).toBeLessThanOrEqual(-6)
    expect(cues[0]?.prompt).toContain('supporting cinematic ambience bed')
  })

  it('plans cinematic editorial cues for investigative audiobook narration', () => {
    const cues = planAudiobookSoundEffects(
      transcript(
        [
          'Epigraph. Part 1, the assignment. Chapter 1.',
          'Amara was a journalist who had never turned down an assignment.',
          'Her editor slid a Manila folder across the desk.',
          'There are senators in this folder. There is a federal judge in this folder.',
          'The agency vets candidates and serves clients who require discretion and privacy.',
          'The primary subject is a man named Dominic Voss on the cover of Forbes.',
        ].join(' '),
        [
          {
            text: 'Epigraph. Part 1, the assignment. Chapter 1.',
            start: 0,
            end: 6,
          },
          {
            text: 'Amara was a journalist who had never turned down an assignment.',
            start: 20,
            end: 26,
          },
          {
            text: 'Her editor slid a Manila folder across the desk.',
            start: 58,
            end: 64,
          },
          {
            text: 'There are senators in this folder. There is a federal judge in this folder.',
            start: 90,
            end: 98,
          },
          {
            text: 'The agency vets candidates and serves clients who require discretion and privacy.',
            start: 132,
            end: 140,
          },
          {
            text: 'The primary subject is a man named Dominic Voss on the cover of Forbes.',
            start: 180,
            end: 188,
          },
        ],
      ),
      { maxCues: 8, durationSeconds: 18, narrationDurationSeconds: 220 },
    )

    expect(cues.map((cue) => cue.label)).toEqual(
      expect.arrayContaining([
        'Chapter sting',
        'Newsroom',
        'Folder foley',
        'Public power',
        'Secrecy',
        'Name reveal',
      ]),
    )
    expect(cues.every((cue) => cue.prompt.includes('no speech'))).toBe(true)
    expect(cues.every((cue) => cue.endSeconds - cue.startSeconds <= 18)).toBe(true)
    expect(cues.find((cue) => cue.label === 'Name reveal')?.mixVolumeDb).toBeGreaterThan(0)
    expect(cues.find((cue) => cue.label === 'Name reveal')?.role).toBe('impact')
    expect(cues.find((cue) => cue.label === 'Folder foley')?.prompt).toContain(
      'layered foreground Foley event',
    )
    expect(cues.some((cue) => cue.role === 'ambience')).toBe(true)
  })

  it('places generated effects forward without brute-force clipping gain', () => {
    expect(getAudiobookSfxTimelineVolumeDb({ mixVolumeDb: 4 })).toBe(9.8)
    expect(getAudiobookSfxTimelineVolumeDb({ role: 'impact', mixVolumeDb: 4 })).toBe(9.6)
    expect(getAudiobookSfxTimelineVolumeDb({ mixVolumeDb: -6 })).toBe(-3.8)
    expect(getAudiobookSfxTimelineVolumeDb({ mixVolumeDb: 7 })).toBe(10.5)
  })

  it('caps repeated chapter stings so the intro does not stack cheap hits', () => {
    const cues = planAudiobookSoundEffects(
      transcript(
        [
          'Selling the V-Con.',
          'A novel.',
          'The V card. A novel.',
          'Epigraph. The truth is rarely pure.',
          'Part 1, the assignment.',
          'Chapter 1 The thing about not turning down.',
        ].join(' '),
        [
          { text: 'Selling the V-Con.', start: 0, end: 2 },
          { text: 'A novel.', start: 3, end: 5 },
          { text: 'The V card. A novel.', start: 6, end: 8 },
          { text: 'Epigraph. The truth is rarely pure.', start: 9, end: 12 },
          { text: 'Part 1, the assignment.', start: 27, end: 30 },
          { text: 'Chapter 1 The thing about not turning down.', start: 39, end: 43 },
        ],
      ),
      { maxCues: 8, durationSeconds: 8, narrationDurationSeconds: 55 },
    )

    const chapterStings = cues.filter((cue) => cue.label === 'Chapter sting')
    expect(chapterStings.length).toBeLessThanOrEqual(2)
    expect(cues.every((cue) => cue.prompt.includes('not a generic AI sweep'))).toBe(true)
  })

  it('adds editorial story hits when narration has drama but no literal foley keyword', () => {
    const cues = planAudiobookSoundEffects(
      transcript(
        [
          'She had always known the promise would come due.',
          'But the choice in front of her changed everything.',
          'Only then did the room feel dangerous.',
        ].join(' '),
        [
          {
            text: 'She had always known the promise would come due.',
            start: 0,
            end: 7,
          },
          {
            text: 'But the choice in front of her changed everything.',
            start: 62,
            end: 68,
          },
          {
            text: 'Only then did the room feel dangerous.',
            start: 118,
            end: 124,
          },
        ],
      ),
      { maxCues: 8, durationSeconds: 8, narrationDurationSeconds: 140 },
    )

    expect(cues.map((cue) => cue.label)).toEqual(
      expect.arrayContaining(['Opening sting', 'Story hit']),
    )
    expect(cues.some((cue) => cue.role === 'impact')).toBe(true)
    expect(cues.some((cue) => cue.role === 'ambience')).toBe(true)
  })

  it('fills uncovered dramatic transcript beats when cue budget has room', () => {
    const cues = planAudiobookSoundEffects(
      transcript(
        [
          'The promise was already broken.',
          'Only then did the hidden truth become dangerous.',
          'Finally, she made the choice alone.',
          'The warning came too late.',
        ].join(' '),
        [
          { text: 'The promise was already broken.', start: 0, end: 6 },
          { text: 'Only then did the hidden truth become dangerous.', start: 45, end: 52 },
          { text: 'Finally, she made the choice alone.', start: 90, end: 96 },
          { text: 'The warning came too late.', start: 135, end: 141 },
        ],
      ),
      { maxCues: 8, durationSeconds: 8, narrationDurationSeconds: 170 },
    )

    expect(cues.filter((cue) => cue.label === 'Story hit').length).toBeGreaterThanOrEqual(3)
    expect([0, 45, 90, 135].every((seconds) => hasNearbyAudibleCue(cues, seconds))).toBe(true)
    expect(cues.length).toBeLessThanOrEqual(8)
  })

  it('adds scene-turn hits when long narration needs movie punctuation', () => {
    const cues = planAudiobookSoundEffects(
      transcript(
        [
          'She walked into the room and understood the promise was already broken.',
          'The answer was not on the page.',
          'For the first time, the silence felt like a warning.',
          'By morning, everyone would know what she had hidden.',
        ].join(' '),
        [
          {
            text: 'She walked into the room and understood the promise was already broken.',
            start: 0,
            end: 7,
          },
          {
            text: 'The answer was not on the page.',
            start: 70,
            end: 76,
          },
          {
            text: 'For the first time, the silence felt like a warning.',
            start: 150,
            end: 157,
          },
          {
            text: 'By morning, everyone would know what she had hidden.',
            start: 230,
            end: 237,
          },
        ],
      ),
      { maxCues: 12, durationSeconds: 12, narrationDurationSeconds: 280 },
    )

    expect(
      cues.filter((cue) => cue.role === 'impact' || cue.role === 'transition').length,
    ).toBeGreaterThanOrEqual(5)
    expect(cues.map((cue) => cue.label)).toContain('Scene turn hit')
    expect(cues.find((cue) => cue.label === 'Scene turn hit')?.prompt).toContain(
      'three-stage movie punctuation',
    )
  })
})
