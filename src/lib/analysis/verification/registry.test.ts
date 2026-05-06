import { describe, expect, it } from 'vite-plus/test'
import {
  DEFAULT_SCENE_VERIFICATION_PROVIDER_ID,
  getDefaultSceneVerificationProvider,
  getSceneVerificationModelLabel,
  getSceneVerificationModelOptions,
  getSceneVerificationProvider,
} from './registry'

describe('scene verification registry', () => {
  it('returns the default provider', () => {
    expect(DEFAULT_SCENE_VERIFICATION_PROVIDER_ID).toBe('gemma')
    expect(getDefaultSceneVerificationProvider().id).toBe('gemma')
  })

  it('resolves provider labels through the registry', () => {
    expect(getSceneVerificationProvider('gemma').label).toBe('Gemma')
    expect(getSceneVerificationModelLabel('lfm')).toBe('LFM')
  })

  it('lists verification model options for UI consumers', () => {
    expect(getSceneVerificationModelOptions()).toEqual([
      { value: 'gemma', label: 'Gemma' },
      { value: 'lfm', label: 'LFM' },
    ])
  })
})
