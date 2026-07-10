import { describe, expect, it } from 'vitest'
import type { MediaTranscript } from '@/types/storage'
import type { AudiobookSfxCue, AudiobookSfxCueRole } from './audiobook-sfx'
import { scoreCinematicReadiness } from './cinematic-readiness'

function cue(
  id: string,
  label: string,
  startSeconds: number,
  mixVolumeDb: number,
  role: AudiobookSfxCueRole = 'foreground',
): AudiobookSfxCue {
  return {
    id,
    label,
    role,
    prompt: `${label} prompt`,
    reason: label,
    sourceText: label,
    startSeconds,
    endSeconds: startSeconds + 8,
    mixVolumeDb,
    guidanceScale: 5,
  }
}

function transcript(segments: MediaTranscript['segments']): MediaTranscript {
  return {
    id: 'transcript-1',
    mediaId: 'media-1',
    model: 'whisper-tiny',
    quantization: 'q8',
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('scoreCinematicReadiness', () => {
  it('rates a balanced image, music, ambience, and foreground SFX plan as strong', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 180,
      imageCount: 24,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 5,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 3,
      cues: [
        cue('1', 'Chapter sting', 0, 0, 'transition'),
        cue('2', 'Newsroom', 20, -8, 'ambience'),
        cue('3', 'Folder foley', 42, 1.5, 'foreground'),
        cue('4', 'Public power', 76, 1.5, 'impact'),
        cue('5', 'Secrecy', 112, -1, 'impact'),
        cue('6', 'Town', 150, -8, 'ambience'),
      ],
    })

    expect(readiness.score).toBeGreaterThanOrEqual(8)
    expect(readiness.grade).toMatch(/strong|excellent/)
    expect(readiness.issues.some((issue) => issue.severity === 'critical')).toBe(false)
    expect(readiness.metrics.depthPrepEnabled).toBe(true)
    expect(readiness.metrics.depthPrepSupported).toBe(true)
    expect(readiness.metrics.finishingEnabled).toBe(true)
  })

  it('flags a slideshow-like setup with no sound design as weak', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 240,
      imageCount: 2,
      musicBedCount: 0,
      sfxDurationSeconds: 3,
      matchImages: false,
      applyCinematicMotion: false,
      prepareDepth: false,
      depthPrepSupported: true,
      applyFinishing: false,
      useImportedSfxLibrary: false,
      libraryMatchedCueCount: 0,
      libraryMatchedForegroundCueCount: 0,
      libraryMatchedImpactCueCount: 0,
      cues: [],
    })

    expect(readiness.score).toBeLessThan(5)
    expect(readiness.grade).toBe('weak')
    expect(readiness.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['few-images', 'motion-off', 'no-sfx', 'no-music-bed']),
    )
  })

  it('warns when cinematic finishing is disabled', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 120,
      imageCount: 12,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: false,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 4,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 2,
      cues: [
        cue('1', 'Chapter sting', 0, 0, 'transition'),
        cue('2', 'Room tone', 20, -8, 'ambience'),
        cue('3', 'Folder foley', 42, 1.5, 'foreground'),
        cue('4', 'Story hit', 80, 1.5, 'impact'),
      ],
    })

    expect(readiness.metrics.finishingEnabled).toBe(false)
    expect(readiness.issues.map((issue) => issue.id)).toContain('finishing-off')
  })

  it('warns when depth-map parallax prep is disabled before generation', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 120,
      imageCount: 12,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: false,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 4,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 2,
      cues: [
        cue('1', 'Chapter sting', 0, 0, 'transition'),
        cue('2', 'Room tone', 20, -8, 'ambience'),
        cue('3', 'Folder foley', 42, 1.5, 'foreground'),
        cue('4', 'Story hit', 80, 1.5, 'impact'),
      ],
    })

    expect(readiness.metrics.depthPrepEnabled).toBe(false)
    expect(readiness.metrics.depthPrepSupported).toBe(true)
    expect(readiness.issues.map((issue) => issue.id)).toContain('depth-prep-off')
  })

  it('warns when depth-map parallax prep is unsupported', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 120,
      imageCount: 12,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: false,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 4,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 2,
      cues: [
        cue('1', 'Chapter sting', 0, 0, 'transition'),
        cue('2', 'Room tone', 20, -8, 'ambience'),
        cue('3', 'Folder foley', 42, 1.5, 'foreground'),
        cue('4', 'Story hit', 80, 1.5, 'impact'),
      ],
    })

    expect(readiness.metrics.depthPrepEnabled).toBe(true)
    expect(readiness.metrics.depthPrepSupported).toBe(false)
    expect(readiness.issues.map((issue) => issue.id)).toContain('depth-prep-unsupported')
  })

  it('warns when the cue plan is repetitive and too dense', () => {
    const cues = Array.from({ length: 12 }, (_, index) =>
      cue(`cue-${index}`, 'Footsteps', index * 4, -1),
    )

    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 80,
      imageCount: 10,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 12,
      libraryMatchedForegroundCueCount: 12,
      libraryMatchedImpactCueCount: 0,
      cues,
    })

    expect(readiness.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['sfx-crowded', 'sfx-repetitive']),
    )
  })

  it('warns when dramatic impact cues repeat too much', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 150,
      imageCount: 18,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 8,
      libraryMatchedForegroundCueCount: 2,
      libraryMatchedImpactCueCount: 4,
      cues: [
        cue('1', 'Riser hit', 8, 2, 'impact'),
        cue('2', 'Riser hit', 34, 2, 'impact'),
        cue('3', 'Riser hit', 72, 2, 'impact'),
        cue('4', 'Riser hit', 118, 2, 'transition'),
        cue('5', 'Key foley', 48, 1, 'foreground'),
        cue('6', 'Desk clock', 88, 1, 'foreground'),
        cue('7', 'Room tone', 0, -8, 'ambience'),
        cue('8', 'Night wind', 96, -8, 'ambience'),
      ],
    })

    expect(readiness.metrics.uniqueCueLabels).toBe(5)
    expect(readiness.metrics.uniqueImpactCueLabels).toBe(1)
    expect(readiness.metrics.dominantImpactCueLabelPct).toBe(100)
    expect(readiness.issues.map((issue) => issue.id)).toContain('sfx-impact-repetitive')
  })

  it('warns when planned cues have no imported studio SFX source matches', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 90,
      imageCount: 10,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 0,
      libraryMatchedForegroundCueCount: 0,
      libraryMatchedImpactCueCount: 0,
      cues: [
        cue('1', 'Door foley', 0, 1, 'foreground'),
        cue('2', 'Scene turn', 28, 1.5, 'impact'),
        cue('3', 'Room tone', 58, -8, 'ambience'),
      ],
    })

    expect(readiness.metrics.libraryMatchedCueCount).toBe(0)
    expect(readiness.metrics.generatedCueCount).toBe(3)
    expect(readiness.issues.map((issue) => issue.id)).toContain('no-imported-sfx-matches')
  })

  it('warns when imported SFX matching is disabled', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 90,
      imageCount: 10,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: false,
      libraryMatchedCueCount: 0,
      libraryMatchedForegroundCueCount: 0,
      libraryMatchedImpactCueCount: 0,
      cues: [
        cue('1', 'Door foley', 0, 1, 'foreground'),
        cue('2', 'Scene turn', 28, 1.5, 'impact'),
        cue('3', 'Room tone', 58, -8, 'ambience'),
      ],
    })

    expect(readiness.metrics.importedSfxLibraryEnabled).toBe(false)
    expect(readiness.issues.map((issue) => issue.id)).toContain('imported-sfx-off')
  })

  it('warns when dramatic transcript beats are undercovered by foreground or impact SFX', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 150,
      imageCount: 18,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 2,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 1,
      transcript: transcript([
        { text: 'The promise was already broken.', start: 20, end: 25 },
        { text: 'Only then did the hidden truth become dangerous.', start: 72, end: 80 },
        { text: 'Finally, she made the choice alone.', start: 130, end: 137 },
      ]),
      cues: [
        cue('1', 'Room tone', 0, -8, 'ambience'),
        cue('2', 'Folder foley', 42, 1.5, 'foreground'),
        cue('3', 'Scene ambience', 96, -8, 'ambience'),
      ],
    })

    expect(readiness.metrics.storyBeatCount).toBe(3)
    expect(readiness.metrics.coveredStoryBeatCount).toBe(0)
    expect(readiness.metrics.storyBeatCoveragePct).toBe(0)
    expect(readiness.issues.map((issue) => issue.id)).toContain('sfx-story-beats-undercovered')
  })

  it('passes story beat coverage when dramatic transcript beats have nearby accents', () => {
    const readiness = scoreCinematicReadiness({
      narrationDurationSeconds: 150,
      imageCount: 18,
      musicBedCount: 1,
      sfxDurationSeconds: 8,
      matchImages: true,
      applyCinematicMotion: true,
      prepareDepth: true,
      depthPrepSupported: true,
      applyFinishing: true,
      useImportedSfxLibrary: true,
      libraryMatchedCueCount: 4,
      libraryMatchedForegroundCueCount: 1,
      libraryMatchedImpactCueCount: 3,
      transcript: transcript([
        { text: 'The promise was already broken.', start: 20, end: 25 },
        { text: 'Only then did the hidden truth become dangerous.', start: 72, end: 80 },
        { text: 'Finally, she made the choice alone.', start: 130, end: 137 },
      ]),
      cues: [
        cue('1', 'Scene turn', 18, 3, 'impact'),
        cue('2', 'Truth reveal', 74, 3, 'impact'),
        cue('3', 'Decision beat', 128, 3, 'impact'),
        cue('4', 'Room tone', 0, -8, 'ambience'),
      ],
    })

    expect(readiness.metrics.storyBeatCount).toBe(3)
    expect(readiness.metrics.coveredStoryBeatCount).toBe(3)
    expect(readiness.metrics.storyBeatCoveragePct).toBe(100)
    expect(readiness.issues.map((issue) => issue.id)).not.toContain('sfx-story-beats-undercovered')
  })
})
