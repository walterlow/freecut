import { describe, expect, it } from 'vite-plus/test'
import {
  TRANSITION_CATEGORY_ORDER,
  getTransitionCategoryStartIndices,
  getTransitionConfigsByCategory,
  getTransitionPresentationConfigs,
} from './transition-ui-config'

function toConfigKey(config: { id: string; direction?: string }): string {
  return `${config.id}:${config.direction ?? ''}`
}

describe('transition-ui-config', () => {
  it('keeps flat config offsets aligned with grouped category ordering', () => {
    for (const category of TRANSITION_CATEGORY_ORDER) {
      const groupedConfigs = getTransitionConfigsByCategory()[category] ?? []
      const startIndex = getTransitionCategoryStartIndices()[category] ?? 0
      const flatSlice = getTransitionPresentationConfigs().slice(
        startIndex,
        startIndex + groupedConfigs.length,
      )

      expect(flatSlice.map(toConfigKey)).toEqual(groupedConfigs.map(toConfigKey))
    }
  })

  it('resolves the glitch card to the glitch transition config', () => {
    const customConfigs = getTransitionConfigsByCategory().custom ?? []
    const glitchIndex = customConfigs.findIndex((config) => config.id === 'glitch')

    expect(glitchIndex).toBeGreaterThanOrEqual(0)

    const startIndex = getTransitionCategoryStartIndices().custom ?? 0
    const flatConfig = getTransitionPresentationConfigs()[startIndex + glitchIndex]
    const groupedConfig = customConfigs[glitchIndex]

    expect(flatConfig).toBeDefined()
    expect(groupedConfig).toBeDefined()
    expect(toConfigKey(flatConfig!)).toBe(toConfigKey(groupedConfig!))
  })

  it('shows chromatic in its own category instead of custom', () => {
    const chromaticConfigs = getTransitionConfigsByCategory().chromatic ?? []
    const customConfigs = getTransitionConfigsByCategory().custom ?? []

    expect(chromaticConfigs.some((config) => config.id === 'chromatic')).toBe(true)
    expect(customConfigs.some((config) => config.id === 'chromatic')).toBe(false)
  })

  it('shows sparkles in the custom category', () => {
    const customConfigs = getTransitionConfigsByCategory().custom ?? []

    expect(customConfigs.some((config) => config.id === 'sparkles')).toBe(true)
    expect(
      (getTransitionConfigsByCategory().light ?? []).some((config) => config.id === 'sparkles'),
    ).toBe(false)
  })

  it('shows liquid distort as a directional custom transition', () => {
    const customConfigs = getTransitionConfigsByCategory().custom ?? []
    const liquidConfigs = customConfigs.filter((config) => config.id === 'liquidDistort')

    expect(liquidConfigs.map((config) => config.direction)).toEqual([
      'from-left',
      'from-right',
      'from-top',
      'from-bottom',
    ])
  })

  it('shows lens warp zoom in the custom category', () => {
    const customConfigs = getTransitionConfigsByCategory().custom ?? []

    expect(customConfigs.some((config) => config.id === 'lensWarpZoom')).toBe(true)
    expect(
      getTransitionPresentationConfigs().some(
        (config) => config.id === 'lensWarpZoom' && config.icon === 'ScanSearch',
      ),
    ).toBe(true)
  })

  it('shows light leak burn as a directional light transition', () => {
    const lightConfigs = getTransitionConfigsByCategory().light ?? []
    const burnConfigs = lightConfigs.filter((config) => config.id === 'lightLeakBurn')

    expect(burnConfigs.map((config) => config.direction)).toEqual([
      'from-left',
      'from-right',
      'from-top',
      'from-bottom',
    ])
    expect(burnConfigs.every((config) => config.icon !== undefined)).toBe(true)
  })

  it('shows film gate slip in the custom category', () => {
    const customConfigs = getTransitionConfigsByCategory().custom ?? []

    expect(customConfigs.some((config) => config.id === 'filmGateSlip')).toBe(true)
    expect(
      getTransitionPresentationConfigs().some(
        (config) => config.id === 'filmGateSlip' && config.icon === 'Film',
      ),
    ).toBe(true)
  })
})
