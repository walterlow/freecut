import { describe, expect, it } from 'vite-plus/test'
import {
  DIRECTOR_4K_PRODUCTION_SETTINGS,
  isDirector4kProductionMode,
} from './cinematic-production-mode'

describe('cinematic production mode', () => {
  it('defines the complete Director 4K automatic production stack', () => {
    expect(DIRECTOR_4K_PRODUCTION_SETTINGS).toMatchObject({
      editingProfile: 'magnates-3d',
      strict4kSources: true,
      usePixabayBroll: true,
      useFreesound: true,
      useSfxLibrary: true,
      prepareDepth: true,
      applyCinematicMotion: true,
      applyTransitions: true,
      applyFinishing: true,
    })
    expect(isDirector4kProductionMode(DIRECTOR_4K_PRODUCTION_SETTINGS)).toBe(true)
  })

  it('does not report Director 4K after a required production layer is disabled', () => {
    expect(
      isDirector4kProductionMode({
        ...DIRECTOR_4K_PRODUCTION_SETTINGS,
        prepareDepth: false,
      }),
    ).toBe(false)
  })
})
