import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem } from '@/types/timeline'
import type { StudioAudioSourceMetadata } from '@/types/studio-audio'
import { isStudioAudioLicenseAllowed, validateStudioAudioLicenses } from './studio-audio-licensing'

function source(licenseCode: StudioAudioSourceMetadata['licenseCode']): StudioAudioSourceMetadata {
  return {
    provider: 'freesound',
    soundId: 42,
    title: 'Rain room tone',
    creator: 'recordist',
    sourceUrl: 'https://freesound.org/s/42/',
    license: `https://creativecommons.org/licenses/${licenseCode}/4.0/`,
    licenseUrl: `https://creativecommons.org/licenses/${licenseCode}/4.0/`,
    licenseCode,
    retrievedAt: '2026-07-10T00:00:00.000Z',
    sourceKind: 'preview',
    reason: 'Rain is described in the scene.',
    confidence: 0.9,
    approval: 'recommended',
    locked: false,
  }
}

function audio(studioAudioSource: StudioAudioSourceMetadata): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Rain',
    src: 'blob:rain',
    studioAudioSource,
  }
}

describe('studio audio licensing', () => {
  it('allows CC0 and CC BY for monetized-video policy', () => {
    expect(isStudioAudioLicenseAllowed(source('cc0'), 'youtube-safe')).toBe(true)
    expect(isStudioAudioLicenseAllowed(source('cc-by'), 'youtube-safe')).toBe(true)
  })

  it('excludes NonCommercial, ShareAlike and unknown recordings', () => {
    expect(isStudioAudioLicenseAllowed(source('non-commercial'), 'youtube-safe')).toBe(false)
    expect(isStudioAudioLicenseAllowed(source('share-alike'), 'youtube-safe')).toBe(false)
    expect(isStudioAudioLicenseAllowed(source('unknown'), 'youtube-safe')).toBe(false)
  })

  it('warns for unapproved CC BY and errors for incompatible licences', () => {
    expect(validateStudioAudioLicenses([audio(source('cc-by'))])[0]?.severity).toBe('warning')
    expect(validateStudioAudioLicenses([audio(source('non-commercial'))])[0]?.severity).toBe(
      'error',
    )
  })
})
