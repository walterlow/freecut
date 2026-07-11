import { describe, expect, it } from 'vitest'
import type { FreesoundAssetMetadata } from '@/types/studio-audio'
import type { FreesoundCueMatch } from '../services/freesound-studio-audio-service'
import { planCinematicFreesoundLayers } from './cinematic-sound-layering'

function asset(id: number): FreesoundAssetMetadata {
  return {
    id,
    name: `sound-${id}`,
    username: 'artist',
    license: 'CC0',
    licenseCode: 'cc0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    soundUrl: `https://freesound.org/s/${id}/`,
    previewUrl: `https://cdn.freesound.org/${id}.mp3`,
    duration: 3,
    sampleRate: 48_000,
    bitDepth: 24,
    channels: 2,
    fileSize: 1000,
    downloads: 100,
    rating: 5,
    description: '',
    tags: [],
    created: '',
    score: 90,
  }
}

function match(role: FreesoundCueMatch['cue']['role']): FreesoundCueMatch {
  return {
    cue: {
      id: 'cue',
      label: 'Reveal',
      role,
      prompt: '',
      reason: '',
      sourceText: '',
      startSeconds: 2,
      endSeconds: 4,
      mixVolumeDb: 0,
      guidanceScale: 6,
    },
    selected: asset(1),
    alternatives: [asset(2), asset(3), asset(2)],
  }
}

describe('planCinematicFreesoundLayers', () => {
  it('builds three unique layers for impacts', () => {
    expect(planCinematicFreesoundLayers(match('impact'))).toEqual([
      { asset: asset(1), role: 'body', offsetSeconds: 0, gainDb: 0 },
      { asset: asset(2), role: 'pre-motion', offsetSeconds: -0.2, gainDb: -5.5 },
      { asset: asset(3), role: 'tail', offsetSeconds: 0.07, gainDb: -7 },
    ])
  })

  it('adds texture to foreground Foley but keeps ambience singular', () => {
    expect(planCinematicFreesoundLayers(match('foreground'))).toHaveLength(2)
    expect(planCinematicFreesoundLayers(match('ambience'))).toHaveLength(1)
  })
})
