import { describe, expect, it } from 'vite-plus/test'
import {
  isCinematicEditingProfile,
  usesStudioDocumentaryGrammar,
} from './cinematic-editing-profile'

describe('cinematic editing profiles', () => {
  it('recognizes the supported automatic editing modes', () => {
    expect(isCinematicEditingProfile('story')).toBe(true)
    expect(isCinematicEditingProfile('compound-parallax')).toBe(true)
    expect(isCinematicEditingProfile('documentary')).toBe(true)
    expect(isCinematicEditingProfile('music-video')).toBe(false)
  })

  it('keeps documentary grammar opt-in', () => {
    expect(usesStudioDocumentaryGrammar('story')).toBe(false)
    expect(usesStudioDocumentaryGrammar('documentary')).toBe(true)
  })
})
