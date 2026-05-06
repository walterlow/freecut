import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import { getMappedSelectionEffectEntry } from './effect-selection'

function createGpuEffect(id: string, gpuEffectType: string): ItemEffect {
  return {
    id,
    enabled: true,
    effect: {
      type: 'gpu-effect',
      gpuEffectType,
      params: {},
    },
  }
}

describe('getMappedSelectionEffectEntry', () => {
  it('maps to the matching stack slot when the effect types line up', () => {
    const displayEffects = [createGpuEffect('display-1', 'gpu-brightness')]
    const targetEffects = [createGpuEffect('target-1', 'gpu-brightness')]

    expect(getMappedSelectionEffectEntry(displayEffects, targetEffects, 'display-1')).toBe(
      targetEffects[0],
    )
  })

  it('skips mismatched effect stacks instead of mapping to the wrong effect', () => {
    const displayEffects = [createGpuEffect('display-1', 'gpu-brightness')]
    const targetEffects = [createGpuEffect('target-1', 'gpu-blur')]

    expect(getMappedSelectionEffectEntry(displayEffects, targetEffects, 'display-1')).toBeNull()
  })
})
