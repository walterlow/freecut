// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  resolveSubCompLayerCapabilityGap,
  resolveSubCompLayerCompositeFlags,
  resolveSubCompLayerMode,
  resolveSubCompLayerScratchLayout,
  resolveSubCompMaskCombineSteps,
  type SubCompLayerScratchLayout,
} from './gpu-subcomp-layer-policy'

interface ScratchLayoutInput {
  usesShaderComposite: boolean
  hasBlendPipeline: boolean
  maskCount: number
}

/**
 * Verbatim copy of the acquisition sequence the layer renderer ran inline before
 * the move: base, effects output, then the optional shader-composite textures,
 * then one texture per mask and one per remaining combine target. It stays here
 * as the equivalence oracle so a slot/order regression cannot slip into the
 * extracted layout planner.
 */
function scratchRolesVerbatim(input: ScratchLayoutInput): string[] {
  const roles: string[] = ['base', 'effected']
  if (input.usesShaderComposite && input.hasBlendPipeline) roles.push('blendOutput')
  if (input.usesShaderComposite) roles.push('blendLayer')
  for (let index = 0; index < input.maskCount; index++) roles.push(`mask${index}`)
  const combineTargets = Math.max(0, input.maskCount - 1)
  for (let index = 0; index < combineTargets; index++) roles.push(`combined${index}`)
  return roles
}

/** Reads the planned slots back as the same acquisition-ordered role list. */
function scratchRolesFromLayout(layout: SubCompLayerScratchLayout): string[] {
  const roles: string[] = new Array(layout.textureCount).fill('unused')
  roles[0] = 'base'
  roles[layout.effectedSlot] = 'effected'
  if (layout.blendOutputSlot !== null) roles[layout.blendOutputSlot] = 'blendOutput'
  if (layout.blendLayerSlot !== null) roles[layout.blendLayerSlot] = 'blendLayer'
  layout.maskSlots.forEach((slot, index) => {
    roles[slot] = `mask${index}`
  })
  layout.combinedMaskSlots.forEach((slot, index) => {
    roles[slot] = `combined${index}`
  })
  return roles
}

/**
 * Verbatim copy of the inline mask fold's invert bookkeeping: the running result
 * inherits the first mask's invert flag only, and every later step combines two
 * already-composed alpha masks.
 */
function combineStepsVerbatim(
  masks: Array<{ inverted: boolean }>,
): Array<{ invertBase: boolean; invertNext: boolean }> {
  const steps: Array<{ invertBase: boolean; invertNext: boolean }> = []
  let currentMaskInverted = masks[0]?.inverted ?? false
  for (let index = 1; index < masks.length; index++) {
    steps.push({
      invertBase: currentMaskInverted,
      invertNext: masks[index]?.inverted ?? false,
    })
    currentMaskInverted = false
  }
  return steps
}

/** Every invert-flag combination for mask counts 0..4. */
function everyMaskSet(): Array<Array<{ inverted: boolean }>> {
  const sets: Array<Array<{ inverted: boolean }>> = [[]]
  for (let count = 1; count <= 4; count++) {
    for (let bits = 0; bits < 1 << count; bits++) {
      sets.push(
        Array.from({ length: count }, (_, index) => ({ inverted: (bits & (1 << index)) !== 0 })),
      )
    }
  }
  return sets
}

describe('resolveSubCompLayerScratchLayout', () => {
  it('matches the acquisition order the renderer ran inline', () => {
    for (const usesShaderComposite of [false, true]) {
      for (const hasBlendPipeline of [false, true]) {
        for (let maskCount = 0; maskCount <= 4; maskCount++) {
          const input = { usesShaderComposite, hasBlendPipeline, maskCount }
          const layout = resolveSubCompLayerScratchLayout(input)
          expect(scratchRolesFromLayout(layout)).toEqual(scratchRolesVerbatim(input))
          expect(layout.textureCount).toBe(scratchRolesVerbatim(input).length)
        }
      }
    }
  })

  it('only reserves the isolated-layer slots for a shader composite', () => {
    const plain = resolveSubCompLayerScratchLayout({
      usesShaderComposite: false,
      hasBlendPipeline: true,
      maskCount: 0,
    })
    expect(plain.blendLayerSlot).toBeNull()
    expect(plain.blendOutputSlot).toBeNull()

    const composited = resolveSubCompLayerScratchLayout({
      usesShaderComposite: true,
      hasBlendPipeline: true,
      maskCount: 0,
    })
    expect(composited.blendOutputSlot).not.toBeNull()
    expect(composited.blendLayerSlot).not.toBeNull()

    const noPipeline = resolveSubCompLayerScratchLayout({
      usesShaderComposite: true,
      hasBlendPipeline: false,
      maskCount: 0,
    })
    expect(noPipeline.blendOutputSlot).toBeNull()
    expect(noPipeline.blendLayerSlot).not.toBeNull()
  })

  it('plans one combine target less than the mask count and never a negative count', () => {
    expect(
      resolveSubCompLayerScratchLayout({
        usesShaderComposite: false,
        hasBlendPipeline: false,
        maskCount: 0,
      }).combinedMaskSlots,
    ).toEqual([])
    expect(
      resolveSubCompLayerScratchLayout({
        usesShaderComposite: false,
        hasBlendPipeline: false,
        maskCount: 1,
      }).combinedMaskSlots,
    ).toEqual([])
    expect(
      resolveSubCompLayerScratchLayout({
        usesShaderComposite: false,
        hasBlendPipeline: false,
        maskCount: 3,
      }).combinedMaskSlots,
    ).toHaveLength(2)
    expect(
      resolveSubCompLayerScratchLayout({
        usesShaderComposite: false,
        hasBlendPipeline: false,
        maskCount: -4,
      }).textureCount,
    ).toBe(2)
  })
})

describe('resolveSubCompMaskCombineSteps', () => {
  it('matches the inline fold bookkeeping for every invert-flag combination', () => {
    const maskSets = everyMaskSet()
    expect(maskSets).toHaveLength(31)
    for (const masks of maskSets) {
      expect(resolveSubCompMaskCombineSteps(masks)).toEqual(combineStepsVerbatim(masks))
    }
  })

  it('inverts the running result only while folding the first mask', () => {
    const steps = resolveSubCompMaskCombineSteps([
      { inverted: true },
      { inverted: true },
      { inverted: false },
    ])
    expect(steps).toEqual([
      { invertBase: true, invertNext: true },
      { invertBase: false, invertNext: false },
    ])
  })

  it('produces no steps for zero or one mask', () => {
    expect(resolveSubCompMaskCombineSteps([])).toEqual([])
    expect(resolveSubCompMaskCombineSteps([{ inverted: true }])).toEqual([])
  })
})

describe('resolveSubCompLayerMode', () => {
  const base = {
    blend: true,
    clear: false,
    hasBlendPipeline: true,
    enabledEffectCount: 0,
    maskCount: 0,
  }

  it('classifies a blend onto an uncleared target as a shader composite', () => {
    expect(resolveSubCompLayerMode(base)).toEqual({
      needsLayerComposite: true,
      usesShaderComposite: true,
      rendersDirectly: false,
    })
  })

  it('never composites when the target is cleared first', () => {
    expect(resolveSubCompLayerMode({ ...base, clear: true })).toEqual({
      needsLayerComposite: false,
      usesShaderComposite: false,
      rendersDirectly: true,
    })
  })

  it('falls back to a direct render without the blend pipeline', () => {
    expect(resolveSubCompLayerMode({ ...base, hasBlendPipeline: false })).toEqual({
      needsLayerComposite: true,
      usesShaderComposite: false,
      rendersDirectly: true,
    })
  })

  it('needs scratch work whenever effects or masks take part', () => {
    expect(
      resolveSubCompLayerMode({ ...base, clear: true, enabledEffectCount: 1 }).rendersDirectly,
    ).toBe(false)
    expect(resolveSubCompLayerMode({ ...base, clear: true, maskCount: 2 }).rendersDirectly).toBe(
      false,
    )
  })

  it('keeps blending without a shader composite when effects are present', () => {
    const mode = resolveSubCompLayerMode({
      ...base,
      blend: false,
      hasBlendPipeline: false,
      enabledEffectCount: 2,
    })
    expect(mode.needsLayerComposite).toBe(false)
    expect(mode.usesShaderComposite).toBe(false)
    expect(mode.rendersDirectly).toBe(false)
  })
})

describe('resolveSubCompLayerCapabilityGap', () => {
  const capable = {
    hasEffectsPipeline: true,
    hasMediaPipeline: true,
    hasShapePipeline: true,
    hasMaskCombinePipeline: true,
    maskCount: 0,
  }

  it('reports no gap when every required pipeline is present', () => {
    expect(resolveSubCompLayerCapabilityGap(capable)).toBeNull()
  })

  it('reports the first missing pipeline in precedence order', () => {
    expect(
      resolveSubCompLayerCapabilityGap({
        ...capable,
        hasEffectsPipeline: false,
        hasMediaPipeline: false,
      }),
    ).toBe('effects-pipeline-unavailable')
    expect(resolveSubCompLayerCapabilityGap({ ...capable, hasMediaPipeline: false })).toBe(
      'media-pipeline-unavailable',
    )
    expect(
      resolveSubCompLayerCapabilityGap({ ...capable, hasShapePipeline: false, maskCount: 1 }),
    ).toBe('shape-pipeline-unavailable')
    expect(
      resolveSubCompLayerCapabilityGap({
        ...capable,
        hasMaskCombinePipeline: false,
        maskCount: 2,
      }),
    ).toBe('mask-combine-pipeline-unavailable')
  })

  it('ignores mask pipelines that no mask needs', () => {
    expect(
      resolveSubCompLayerCapabilityGap({
        ...capable,
        hasShapePipeline: false,
        hasMaskCombinePipeline: false,
        maskCount: 1,
      }),
    ).toBe('shape-pipeline-unavailable')
    expect(
      resolveSubCompLayerCapabilityGap({
        hasEffectsPipeline: true,
        hasMediaPipeline: true,
        hasShapePipeline: true,
        hasMaskCombinePipeline: false,
        maskCount: 1,
      }),
    ).toBeNull()
    expect(
      resolveSubCompLayerCapabilityGap({
        hasEffectsPipeline: true,
        hasMediaPipeline: true,
        hasShapePipeline: false,
        hasMaskCombinePipeline: false,
        maskCount: 0,
      }),
    ).toBeNull()
  })
})

describe('resolveSubCompLayerCompositeFlags', () => {
  it('clears and never blends the isolated layer texture', () => {
    expect(
      resolveSubCompLayerCompositeFlags({
        usesShaderComposite: true,
        clear: false,
        blend: true,
        masks: [],
      }),
    ).toEqual({ clear: true, blend: false, maskInvert: false })
  })

  it('keeps the caller write flags when the layer targets the output directly', () => {
    expect(
      resolveSubCompLayerCompositeFlags({
        usesShaderComposite: false,
        clear: false,
        blend: true,
        masks: [],
      }),
    ).toEqual({ clear: false, blend: true, maskInvert: false })
  })

  it('inverts only a single mask and leaves a folded mask set alone', () => {
    expect(
      resolveSubCompLayerCompositeFlags({
        usesShaderComposite: false,
        clear: true,
        blend: false,
        masks: [{ inverted: true }],
      }).maskInvert,
    ).toBe(true)
    expect(
      resolveSubCompLayerCompositeFlags({
        usesShaderComposite: false,
        clear: true,
        blend: false,
        masks: [{ inverted: true }, { inverted: true }],
      }).maskInvert,
    ).toBe(false)
    expect(
      resolveSubCompLayerCompositeFlags({
        usesShaderComposite: false,
        clear: true,
        blend: false,
        masks: [],
      }).maskInvert,
    ).toBe(false)
  })
})
