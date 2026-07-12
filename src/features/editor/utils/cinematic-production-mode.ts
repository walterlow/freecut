import type { CinematicEditingProfile } from './cinematic-editing-profile'

export interface CinematicProductionSettings {
  editingProfile: CinematicEditingProfile
  maxCues: number
  sfxDuration: number
  matchImages: boolean
  applyCinematicMotion: boolean
  applyTransitions: boolean
  prepareDepth: boolean
  applyFinishing: boolean
  autoMusicBed: boolean
  useSfxLibrary: boolean
  useFreesound: boolean
  usePixabayBroll: boolean
  strict4kSources: boolean
  auditionSfx: boolean
}

export const DIRECTOR_4K_PRODUCTION_SETTINGS: CinematicProductionSettings = {
  editingProfile: 'magnates-3d',
  maxCues: 42,
  sfxDuration: 14,
  matchImages: true,
  applyCinematicMotion: true,
  applyTransitions: true,
  prepareDepth: true,
  applyFinishing: true,
  autoMusicBed: true,
  useSfxLibrary: true,
  useFreesound: true,
  usePixabayBroll: true,
  strict4kSources: true,
  auditionSfx: true,
}

export function isDirector4kProductionMode(settings: CinematicProductionSettings): boolean {
  const target = DIRECTOR_4K_PRODUCTION_SETTINGS
  return (
    settings.editingProfile === target.editingProfile &&
    settings.maxCues >= target.maxCues &&
    settings.sfxDuration >= target.sfxDuration &&
    settings.matchImages &&
    settings.applyCinematicMotion &&
    settings.applyTransitions &&
    settings.prepareDepth &&
    settings.applyFinishing &&
    settings.autoMusicBed &&
    settings.useSfxLibrary &&
    settings.useFreesound &&
    settings.usePixabayBroll &&
    settings.strict4kSources &&
    settings.auditionSfx
  )
}
