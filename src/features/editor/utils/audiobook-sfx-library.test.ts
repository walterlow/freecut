import { describe, expect, it } from 'vitest'
import type { MediaMetadata } from '@/types/storage'
import type { AudiobookSfxCue } from './audiobook-sfx'
import {
  findAudiobookSfxLibraryMatch,
  matchAudiobookSfxLibraryAssets,
} from './audiobook-sfx-library'

function media(
  partial: Partial<MediaMetadata> & Pick<MediaMetadata, 'id' | 'fileName'>,
): MediaMetadata {
  const { id, fileName, ...overrides } = partial
  return {
    id,
    storageType: 'opfs',
    fileName,
    fileSize: 1000,
    mimeType: partial.mimeType ?? 'audio/wav',
    duration: partial.duration ?? 2,
    width: 0,
    height: 0,
    fps: 0,
    codec: 'pcm_s16le',
    bitrate: 0,
    tags: partial.tags ?? [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function cue(
  partial: Partial<AudiobookSfxCue> & Pick<AudiobookSfxCue, 'id' | 'label' | 'role'>,
): AudiobookSfxCue {
  return {
    prompt: '',
    reason: '',
    sourceText: '',
    startSeconds: 0,
    endSeconds: 2,
    mixVolumeDb: 0,
    guidanceScale: 6,
    ...partial,
  }
}

describe('audiobook SFX library matching', () => {
  it('prefers a clearly named studio impact asset over narration or music files', () => {
    const match = findAudiobookSfxLibraryMatch(
      cue({
        id: 'cue-1',
        label: 'Scene turn hit',
        role: 'impact',
        sourceText: 'Only then did the truth become dangerous.',
      }),
      [
        media({ id: 'voice', fileName: 'full_story_narration.mp3', duration: 300 }),
        media({ id: 'song', fileName: 'cinematic underscore music bed.wav', duration: 30 }),
        media({
          id: 'hit',
          fileName: 'premium-cinematic-thriller-reveal-impact-hit.wav',
          duration: 2.4,
          tags: ['studio-sfx', 'impact'],
        }),
      ],
    )

    expect(match?.media.id).toBe('hit')
    expect(match?.score).toBeGreaterThanOrEqual(6)
    expect(match?.reasons).toContain('library-tag')
  })

  it('matches prop Foley cues to imported Foley assets', () => {
    const match = findAudiobookSfxLibraryMatch(
      cue({
        id: 'cue-1',
        label: 'Folder foley',
        role: 'foreground',
        sourceText: 'The folder opened.',
      }),
      [
        media({
          id: 'paper',
          fileName: 'close-mic-paper-folder-foley-desk-rustle.wav',
          tags: ['sfx'],
        }),
        media({
          id: 'wind',
          fileName: 'night wind ambience.wav',
          duration: 20,
          tags: ['ambience'],
        }),
      ],
    )

    expect(match?.media.id).toBe('paper')
  })

  it('limits repeated non-ambience asset use so one hit does not cover the whole plan', () => {
    const matches = matchAudiobookSfxLibraryAssets(
      [
        cue({ id: 'one', label: 'Scene turn hit', role: 'impact', startSeconds: 1 }),
        cue({ id: 'two', label: 'Story hit', role: 'impact', startSeconds: 10 }),
        cue({ id: 'three', label: 'Public power', role: 'impact', startSeconds: 20 }),
      ],
      [
        media({
          id: 'hit-a',
          fileName: 'cinematic-impact-hit-trailer-boom.wav',
          tags: ['studio-sfx', 'impact'],
        }),
        media({
          id: 'hit-b',
          fileName: 'thriller-reveal-impact-hit.wav',
          tags: ['studio-sfx', 'impact'],
        }),
      ],
      { maxUsesPerAsset: 1 },
    )

    expect(matches.map((match) => match.media.id)).toEqual(['hit-a', 'hit-b'])
  })
})
