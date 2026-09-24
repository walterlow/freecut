/**
 * Pure decision policy for compositing a prepared GPU sub-composition layer
 * into a texture (`gpu.ts`). Nothing in here touches a `GPUTexture`, a render
 * target, a pool or a cached participant: every function decides over plain
 * counts / booleans / mask flags so the branch ladder of the layer renderer can
 * be unit tested without a device. Texture acquisition, mask rendering and the
 * shader blend stay in `gpu.ts`, driven by the layout and flags computed here.
 */

/** The invert flag of a resolved sub-composition mask, the only mask field policy reads. */
export interface SubCompMaskInvertFlag {
  inverted: boolean
}

export interface SubCompLayerModeInput {
  /** The caller asked to blend this layer over the content already in the target. */
  blend: boolean
  /** The caller asked to clear the target first. */
  clear: boolean
  hasBlendPipeline: boolean
  enabledEffectCount: number
  maskCount: number
}

export interface SubCompLayerMode {
  /** There is existing target content this layer must composite over. */
  needsLayerComposite: boolean
  /**
   * The existing target content participates in the layer render, so the layer
   * must be rendered isolated first and blended in afterwards.
   */
  usesShaderComposite: boolean
  /**
   * No effects, no masks and no shader composite: the layer needs no scratch
   * textures at all and the participant renderer targets the output directly.
   */
  rendersDirectly: boolean
}

/**
 * Classifies the layer composite up front: a blend onto an uncleared target needs
 * the two-step shader composite; an untouched layer falls through to the plain
 * participant renderer.
 */
export function resolveSubCompLayerMode(input: SubCompLayerModeInput): SubCompLayerMode {
  const needsLayerComposite = input.blend && !input.clear
  const usesShaderComposite = needsLayerComposite && input.hasBlendPipeline
  return {
    needsLayerComposite,
    usesShaderComposite,
    rendersDirectly:
      input.enabledEffectCount === 0 && input.maskCount === 0 && !usesShaderComposite,
  }
}

export type SubCompLayerCapabilityGap =
  | 'effects-pipeline-unavailable'
  | 'media-pipeline-unavailable'
  | 'shape-pipeline-unavailable'
  | 'mask-combine-pipeline-unavailable'

export interface SubCompLayerCapabilityInput {
  hasEffectsPipeline: boolean
  hasMediaPipeline: boolean
  hasShapePipeline: boolean
  hasMaskCombinePipeline: boolean
  maskCount: number
}

/**
 * `null` when the layer can be composited, otherwise the first missing pipeline
 * capability. Mask pipelines are only required when masks actually take part.
 */
export function resolveSubCompLayerCapabilityGap(
  input: SubCompLayerCapabilityInput,
): SubCompLayerCapabilityGap | null {
  if (!input.hasEffectsPipeline) return 'effects-pipeline-unavailable'
  if (!input.hasMediaPipeline) return 'media-pipeline-unavailable'
  if (input.maskCount > 0 && !input.hasShapePipeline) return 'shape-pipeline-unavailable'
  if (input.maskCount > 1 && !input.hasMaskCombinePipeline) {
    return 'mask-combine-pipeline-unavailable'
  }
  return null
}

export interface SubCompLayerScratchLayoutInput {
  usesShaderComposite: boolean
  hasBlendPipeline: boolean
  maskCount: number
}

export interface SubCompLayerScratchLayout {
  /** Total number of scratch textures to acquire, in acquisition order. */
  textureCount: number
  /** Slot of the effects-output texture (the base layer texture always occupies slot 0). */
  effectedSlot: number
  /** Slot holding the shader-blend result, or `null` when the layer renders into the target. */
  blendOutputSlot: number | null
  /** Slot holding the isolated layer texture, or `null` when there is no shader composite. */
  blendLayerSlot: number | null
  /** Slots of the per-mask textures, in mask order. */
  maskSlots: number[]
  /** Slots of the pairwise mask-combine targets, in combine order. */
  combinedMaskSlots: number[]
}

/**
 * Plans the scratch texture budget of one layer: which acquired slot holds which
 * intermediate, in acquisition order. Keeps the slot arithmetic — especially the
 * `maskCount - 1` combine targets — in one testable place.
 */
export function resolveSubCompLayerScratchLayout(
  input: SubCompLayerScratchLayoutInput,
): SubCompLayerScratchLayout {
  const maskCount = Math.max(0, input.maskCount)
  let slot = 1
  const effectedSlot = slot++
  let blendOutputSlot: number | null = null
  let blendLayerSlot: number | null = null
  if (input.usesShaderComposite) {
    if (input.hasBlendPipeline) blendOutputSlot = slot++
    blendLayerSlot = slot++
  }
  const maskSlots = Array.from({ length: maskCount }, () => slot++)
  const combinedMaskSlots = Array.from({ length: Math.max(0, maskCount - 1) }, () => slot++)
  return {
    textureCount: slot,
    effectedSlot,
    blendOutputSlot,
    blendLayerSlot,
    maskSlots,
    combinedMaskSlots,
  }
}

export interface SubCompMaskCombineStep {
  invertBase: boolean
  invertNext: boolean
}

/**
 * Pairwise fold of the layer masks: step `i` combines the running result with
 * `masks[i + 1]`. Only the first step inherits the first mask's invert flag —
 * later steps combine two already-composed alpha masks, so inverting the running
 * result again would flip content the earlier step already handled.
 */
export function resolveSubCompMaskCombineSteps(
  masks: ReadonlyArray<SubCompMaskInvertFlag>,
): SubCompMaskCombineStep[] {
  return masks.slice(1).map((mask, index) => ({
    invertBase: index === 0 ? (masks[0]?.inverted ?? false) : false,
    invertNext: mask.inverted,
  }))
}

export interface SubCompLayerCompositeFlagsInput {
  usesShaderComposite: boolean
  clear: boolean
  blend: boolean
  masks: ReadonlyArray<SubCompMaskInvertFlag>
}

export interface SubCompLayerCompositeFlags {
  clear: boolean
  blend: boolean
  maskInvert: boolean | undefined
}

/**
 * Translates the caller's target-write request into the composite's own write
 * flags: an isolated layer always clears its texture (the shader blend restores
 * the target content afterwards) and never blends with it. `maskInvert` only
 * applies to a single mask; a folded mask set has its inverts baked in already.
 */
export function resolveSubCompLayerCompositeFlags(
  input: SubCompLayerCompositeFlagsInput,
): SubCompLayerCompositeFlags {
  return {
    clear: input.usesShaderComposite ? true : input.clear,
    blend: input.usesShaderComposite ? false : input.blend,
    maskInvert: input.masks.length === 1 ? input.masks[0]?.inverted : false,
  }
}
