import { describe, expect, it } from 'vite-plus/test'
import { getGpuTransition, getGpuTransitionIds } from './index'

describe('GPU transition registry', () => {
  it('registers liquid distort as a directional GPU transition', () => {
    const def = getGpuTransition('liquidDistort')

    expect(getGpuTransitionIds()).toContain('liquidDistort')
    expect(def).toMatchObject({
      id: 'liquidDistort',
      name: 'Liquid Distort',
      category: 'custom',
      entryPoint: 'liquidDistortFragment',
      hasDirection: true,
      directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
      uniformSize: 48,
    })
  })

  it('packs liquid distort uniforms within its declared buffer size', () => {
    const def = getGpuTransition('liquidDistort')

    expect(def).toBeDefined()
    const uniforms = def!.packUniforms(0.35, 1920, 1080, 2, {
      intensity: 1.25,
      scale: 5,
      turbulence: 0.9,
      edgeSoftness: 0.16,
      chroma: 0.5,
      swirl: 1.1,
      shine: 0.8,
    })

    expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    expect(Array.from(uniforms)).toEqual([
      expect.closeTo(0.35),
      1920,
      1080,
      2,
      1.25,
      5,
      expect.closeTo(0.9),
      expect.closeTo(0.16),
      0.5,
      expect.closeTo(1.1),
      expect.closeTo(0.8),
      0,
    ])
  })
})
