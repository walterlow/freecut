/**
 * Pure selection policy for the sub-composition child pass in `gpu.ts`: which
 * children of a sub-composition become GPU layers this frame, with which masks,
 * effect stack and animated transform. Nothing in here touches a `GPUTexture`,
 * a render target or a pool — acquiring the output texture and compositing each
 * planned layer stays in `gpu.ts`, driven by the layer list computed here.
 *
 * One evaluation still belongs to the renderer: whether the GPU mask pipeline
 * can draw a set of masks needs the shape pipeline's own path resolver, so the
 * caller injects `areChildMasksSupported`.
 */

import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { getAnimatedTransform } from '../canvas-keyframes'
import {
  combineEffects,
  getAdjustmentLayerEffects,
  type AdjustmentLayerWithTrackOrder,
} from '../canvas-effects'
import { getItemRenderTimelineSpan } from '../render-span'
import type {
  CanvasSettings,
  ItemRenderContext,
  SubCompRenderData,
  TransitionParticipantRenderState,
} from './types'

/** The one mask field the child pass reads: the track the mask scopes. */
export interface SubCompChildMaskScope {
  trackOrder: number
}

type SubCompChildTrack = SubCompRenderData['sortedTracks'][number]

/** One child that survived the track / frame / kind / blend gates. */
interface SubCompChildCandidate<TMask extends SubCompChildMaskScope> {
  item: TimelineItem
  trackOrder: number
  masks: TMask[]
}

/** One planned child layer: the participant to render and the masks scoping it. */
export interface SubCompChildLayer<TMask extends SubCompChildMaskScope> {
  participant: TransitionParticipantRenderState
  masks: TMask[]
}

/** The target-write request of one child layer: what the layer composite does to the output texture. */
export interface SubCompChildLayerWrite {
  /** The first layer starts the target content, so it must clear it. */
  clear: boolean
  blend: boolean
}

/**
 * The write requests of a child layer pass, in render order: the first layer
 * clears the output texture and every later layer blends over what is already
 * there. Returned as a record the caller indexes, so the layer loop carries no
 * index bookkeeping of its own.
 */
export function resolveSubCompChildLayerWrites(layerCount: number): SubCompChildLayerWrite[] {
  return Array.from({ length: layerCount }, (_, index) => ({
    clear: index === 0,
    blend: true,
  }))
}

export interface SubCompChildLayerPlanInput<TMask extends SubCompChildMaskScope> {
  sortedTracks: SubCompRenderData['sortedTracks']
  keyframesMap: SubCompRenderData['keyframesMap']
  localFrame: number
  occlusionCutoffOrder: number | null
  activeMasks: ReadonlyArray<TMask>
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  canvasSettings: CanvasSettings
  /** Preview overrides the child effect stack resolves through. */
  effectsContext: Pick<
    ItemRenderContext,
    'renderMode' | 'getPreviewEffectsOverride' | 'getLiveItemSnapshotById'
  >
  hasBlendPipeline: boolean
  hasEffectsPipeline: boolean
  /**
   * Whether the GPU mask pipeline can render this child's applicable masks.
   * Injected because the predicate needs the shape pipeline's path resolver,
   * which lives with the shape renderer in `gpu.ts`.
   */
  areChildMasksSupported: (masks: ReadonlyArray<TMask>) => boolean
}

/** A hidden track, or one above the occlusion cutoff, contributes no layers. */
function isSubCompChildTrackRendered(
  track: SubCompChildTrack,
  occlusionCutoffOrder: number | null,
): boolean {
  if (!track.visible) return false
  if (occlusionCutoffOrder !== null && track.order > occlusionCutoffOrder) return false
  return true
}

/**
 * Adjustment layers, controllers and shape masks shape other items instead of
 * rendering themselves, and an item outside its frame window has no content at
 * the local frame.
 */
function isSubCompChildItemRendered(item: TimelineItem, localFrame: number): boolean {
  if (localFrame < item.from || localFrame >= item.from + item.durationInFrames) return false
  if (item.type === 'adjustment' || item.type === 'controller') return false
  if (item.type === 'shape' && item.isMask) return false
  return true
}

/**
 * A non-normal blend mode needs the media blend pipeline; without it the whole
 * sub-composition falls back rather than render a layer with the wrong blend.
 */
function isSubCompChildBlendSupported(item: TimelineItem, hasBlendPipeline: boolean): boolean {
  if (!item.blendMode || item.blendMode === 'normal') return true
  return hasBlendPipeline
}

/**
 * A child's effect stack may only hold GPU effects — any other enabled effect
 * means the sub-composition falls back — and an enabled GPU effect needs the
 * effects pipeline to run at all.
 */
function isSubCompChildEffectsSupported(
  effects: ReadonlyArray<ItemEffect>,
  hasEffectsPipeline: boolean,
): boolean {
  if (effects.some((effect) => effect.enabled && effect.effect.type !== 'gpu-effect')) return false
  if (effects.some((effect) => effect.enabled) && !hasEffectsPipeline) return false
  return true
}

/**
 * The child's effect stack: its preview override (or authored effects) plus the
 * adjustment layers above it, combined in the order the item pass applied them.
 */
function resolveSubCompChildEffects<TMask extends SubCompChildMaskScope>(
  candidate: SubCompChildCandidate<TMask>,
  input: SubCompChildLayerPlanInput<TMask>,
): ItemEffect[] {
  const context = input.effectsContext
  const itemEffects =
    (context.renderMode === 'preview'
      ? context.getPreviewEffectsOverride?.(candidate.item.id)
      : undefined) ??
    candidate.item.effects ??
    []
  const adjustmentEffects = getAdjustmentLayerEffects(
    candidate.trackOrder,
    input.adjustmentLayers,
    input.localFrame,
    context.renderMode === 'preview' ? context.getPreviewEffectsOverride : undefined,
    context.renderMode === 'preview' ? context.getLiveItemSnapshotById : undefined,
  )
  return combineEffects(itemEffects, adjustmentEffects)
}

/**
 * Walks the sub-composition tracks bottom-to-top and keeps every item that can
 * become a layer: visible track, inside the occlusion cutoff, active at the
 * local frame, a rendering item kind, and a blend the pipelines can express.
 * `null` once a blend gate rejects the frame.
 */
function collectSubCompChildCandidates<TMask extends SubCompChildMaskScope>(
  input: SubCompChildLayerPlanInput<TMask>,
): Array<SubCompChildCandidate<TMask>> | null {
  const candidates: Array<SubCompChildCandidate<TMask>> = []
  for (const track of input.sortedTracks) {
    if (!isSubCompChildTrackRendered(track, input.occlusionCutoffOrder)) continue
    for (const item of track.items) {
      if (!isSubCompChildItemRendered(item, input.localFrame)) continue
      if (!isSubCompChildBlendSupported(item, input.hasBlendPipeline)) return null
      candidates.push({
        item,
        trackOrder: track.order,
        // The masks scoping this track: the ones authored on tracks below it.
        masks: input.activeMasks.filter((mask) =>
          doesMaskAffectTrack(mask.trackOrder, track.order),
        ),
      })
    }
  }
  return candidates
}

/**
 * Turns the candidates into renderable layers in render order, resolving the
 * mask-support gate, then the effect stack and the participant transform, only
 * for the items that reached each step. `null` when a gate rejects the frame or
 * no child survived.
 */
function buildSubCompChildLayers<TMask extends SubCompChildMaskScope>(
  candidates: ReadonlyArray<SubCompChildCandidate<TMask>>,
  input: SubCompChildLayerPlanInput<TMask>,
): Array<SubCompChildLayer<TMask>> | null {
  const layers: Array<SubCompChildLayer<TMask>> = []
  for (const candidate of candidates) {
    if (!input.areChildMasksSupported(candidate.masks)) return null
    const effects = resolveSubCompChildEffects(candidate, input)
    if (!isSubCompChildEffectsSupported(effects, input.hasEffectsPipeline)) return null
    layers.push({
      participant: {
        item: candidate.item,
        transform: getAnimatedTransform(
          candidate.item,
          input.keyframesMap.get(candidate.item.id),
          input.localFrame,
          input.canvasSettings,
        ),
        effects,
        renderSpan: getItemRenderTimelineSpan(candidate.item),
      },
      masks: candidate.masks,
    })
  }
  if (layers.length === 0) return null
  return layers
}

/**
 * The child layers of one sub-composition frame, in render order, or `null` when
 * the frame cannot be rendered as GPU layers: no child survived the gates, or
 * one of them needs a pipeline this render does not have.
 */
export function resolveSubCompChildLayers<TMask extends SubCompChildMaskScope>(
  input: SubCompChildLayerPlanInput<TMask>,
): Array<SubCompChildLayer<TMask>> | null {
  const candidates = collectSubCompChildCandidates(input)
  if (!candidates) return null
  return buildSubCompChildLayers(candidates, input)
}
