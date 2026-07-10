const CINEMATIC_EDITING_PROFILES = ['story', 'documentary'] as const

export type CinematicEditingProfile = (typeof CINEMATIC_EDITING_PROFILES)[number]

export function isCinematicEditingProfile(value: string): value is CinematicEditingProfile {
  return CINEMATIC_EDITING_PROFILES.includes(value as CinematicEditingProfile)
}

export function usesStudioDocumentaryGrammar(profile: CinematicEditingProfile): boolean {
  return profile === 'documentary'
}
