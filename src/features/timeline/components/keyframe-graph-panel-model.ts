/**
 * Keyframe Graph Panel — pure model
 *
 * Vector proxy guards, legacy-vector promotion, keyframe move planning and
 * clipboard paste planning for the keyframe graph panel. Everything here is a
 * plain function: values the panel owns (item ids, keyframe maps, blocked
 * ranges, scrubbing callbacks) arrive as parameters.
 */

import type { TFunction } from 'i18next'
import {
  buildVectorPromotionPlan,
  remapLegacyVectorPromotionIdentities,
  resolveAnimatedTransform,
  type getTransitionBlockedRanges,
} from '@/features/timeline/deps/keyframes'
import {
  findStoredVectorKeyframe,
  getStoredVectorKeyframeId,
  getVectorPropertyProxy,
  toVectorScalePercent,
  type VectorPropertyProxy,
} from '@/features/timeline/deps/keyframes-contract'
import { getSourceDimensions, resolveTransform } from '@/features/timeline/deps/composition-runtime'
import type {
  AnimatableProperty,
  EasingConfig,
  EasingType,
  ItemKeyframes,
  Keyframe,
  KeyframeClipboard,
  KeyframeRef,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import * as timelineActions from '../stores/timeline-actions'
import { useKeyframesStore } from '../stores/keyframes-store'
import { isVectorPropertySeparated, resolveEditorScalarLane } from './edit-keyframe-panel-model'

export function getEditableVectorProxy(
  property: AnimatableProperty,
  itemKeyframes: ItemKeyframes | null | undefined,
): VectorPropertyProxy | null {
  const proxy = getVectorPropertyProxy(property)
  if (!proxy || isVectorPropertySeparated(itemKeyframes, proxy.property)) return null
  return proxy
}

export function buildLegacyVectorPromotionAtFrame(params: {
  property: VectorAnimatableProperty
  itemKeyframes: ItemKeyframes | undefined
  baseTransform: ReturnType<typeof resolveTransform>
  frame: number
}) {
  const plan = buildVectorPromotionPlan(params)
  const keyframe = plan.vectorProperty.keyframes.find(
    (candidate) => candidate.frame === params.frame,
  )
  return keyframe ? { plan, keyframe } : null
}

export function applyVectorPromotion(params: {
  itemId: string
  plan: ReturnType<typeof buildVectorPromotionPlan>
  commit: boolean
}) {
  if (params.commit) {
    timelineActions.promoteTransformToVector(
      params.itemId,
      params.plan.vectorProperty,
      params.plan.removeScalarProperties,
    )
    return
  }
  useKeyframesStore
    .getState()
    ._replaceScalarPropertiesWithVectorProperty(
      params.itemId,
      params.plan.vectorProperty,
      params.plan.removeScalarProperties,
    )
}

export function duplicateVectorKeyframeEntry(params: {
  ref: KeyframeRef
  frame: number
  value: number
  proxy: { property: VectorAnimatableProperty; axis: 'x' | 'y' }
  itemId: string
  itemKeyframes: ItemKeyframes | undefined
  baseTransform: ReturnType<typeof resolveTransform>
  duplicatedKeys: Set<string>
}): KeyframeRef | null {
  const storedId = getStoredVectorKeyframeId(params.ref.keyframeId, params.proxy.axis)
  const duplicateKey = `${params.proxy.property}:${storedId}:${params.frame}`
  if (params.duplicatedKeys.has(duplicateKey)) return null
  params.duplicatedKeys.add(duplicateKey)

  const source = findStoredVectorKeyframe(params.itemKeyframes, params.proxy.property, storedId)
  if (source) {
    const keyframeId = timelineActions.upsertVectorKeyframe(params.itemId, params.proxy.property, {
      frame: params.frame,
      value: { ...source.value, [params.proxy.axis]: params.value },
      easing: source.easing,
      easingConfig: source.easingConfig,
      temporalEase: source.temporalEase,
      spatial: source.spatial,
    })
    return keyframeId
      ? {
          itemId: params.itemId,
          property: params.ref.property,
          keyframeId: params.proxy.axis === 'y' ? `${keyframeId}:y` : keyframeId,
        }
      : null
  }

  const plan = buildVectorPromotionPlan({
    property: params.proxy.property,
    itemKeyframes: params.itemKeyframes,
    baseTransform: params.baseTransform,
    includeFrame: params.frame,
  })
  const target = plan.vectorProperty.keyframes.find((keyframe) => keyframe.frame === params.frame)
  if (!target) return null
  target.value = { ...target.value, [params.proxy.axis]: params.value }
  applyVectorPromotion({ itemId: params.itemId, plan, commit: true })
  return {
    itemId: params.itemId,
    property: params.ref.property,
    keyframeId: params.proxy.axis === 'y' ? `${target.id}:y` : target.id,
  }
}

interface ScalarPastePayload {
  itemId: string
  property: AnimatableProperty
  frame: number
  value: number
  easing: EasingType
  easingConfig?: EasingConfig
}

interface VectorPastePayload {
  property: AnimatableProperty
  vectorProperty: VectorAnimatableProperty
  axis: 'x' | 'y'
  frame: number
  value: number
  easing: EasingType
  easingConfig?: EasingConfig
}

export const VECTOR_COMPOUND_PRIMARY: Record<VectorAnimatableProperty, 'x' | 'width' | 'anchorX'> = {
  position: 'x',
  scale: 'width',
  anchor: 'anchorX',
}

function isPastePropertySupported(
  availableProperties: AnimatableProperty[],
  property: AnimatableProperty,
  vector: VectorPropertyProxy | null,
): boolean {
  if (availableProperties.includes(property)) return true
  if (!vector) return false
  return availableProperties.includes(VECTOR_COMPOUND_PRIMARY[vector.property])
}

function isPasteFrameBlocked(
  frame: number,
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>,
): boolean {
  return blockedRanges.some((range) => frame >= range.start && frame < range.end)
}

export function buildKeyframePastePlan(params: {
  clipboard: KeyframeClipboard
  item: TimelineItem
  anchorFrame: number
  availableProperties: AnimatableProperty[]
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>
  supportsVectors: boolean
  itemKeyframes?: ItemKeyframes | null
}): {
  scalarPayloads: ScalarPastePayload[]
  vectorPayloads: VectorPastePayload[]
  skippedUnsupported: number
  skippedBlocked: number
} {
  const scalarPayloads: ScalarPastePayload[] = []
  const vectorPayloads: VectorPastePayload[] = []
  let skippedUnsupported = 0
  let skippedBlocked = 0
  for (const keyframe of params.clipboard.keyframes) {
    const vector = params.supportsVectors
      ? getEditableVectorProxy(keyframe.property, params.itemKeyframes)
      : null
    if (!isPastePropertySupported(params.availableProperties, keyframe.property, vector)) {
      skippedUnsupported += 1
      continue
    }
    const frame = Math.max(
      0,
      Math.min(params.item.durationInFrames - 1, params.anchorFrame + keyframe.frame),
    )
    if (isPasteFrameBlocked(frame, params.blockedRanges)) {
      skippedBlocked += 1
      continue
    }
    if (vector) {
      vectorPayloads.push({
        property: keyframe.property,
        vectorProperty: vector.property,
        axis: vector.axis,
        frame,
        value: keyframe.value,
        easing: keyframe.easing,
        easingConfig: keyframe.easingConfig,
      })
      continue
    }
    scalarPayloads.push({
      itemId: params.item.id,
      property: keyframe.property,
      frame,
      value: keyframe.value,
      easing: keyframe.easing,
      easingConfig: keyframe.easingConfig,
    })
  }
  return { scalarPayloads, vectorPayloads, skippedUnsupported, skippedBlocked }
}

export function pasteVectorKeyframePayload(params: {
  payload: VectorPastePayload
  item: TimelineItem
  baseTransform: ReturnType<typeof resolveTransform>
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}): KeyframeRef | null {
  const itemKeyframes = params.getKeyframes(params.item.id)
  const lane = itemKeyframes?.vectorProperties?.find(
    (candidate) => candidate.property === params.payload.vectorProperty,
  )
  if (!lane?.keyframes.length) {
    const plan = buildVectorPromotionPlan({
      property: params.payload.vectorProperty,
      itemKeyframes,
      baseTransform: params.baseTransform,
      includeFrame: params.payload.frame,
    })
    const target = plan.vectorProperty.keyframes.find(
      (keyframe) => keyframe.frame === params.payload.frame,
    )
    if (!target) return null
    target.value = { ...target.value, [params.payload.axis]: params.payload.value }
    target.easing = params.payload.easing
    target.easingConfig = params.payload.easingConfig
    applyVectorPromotion({ itemId: params.item.id, plan, commit: true })
    return {
      itemId: params.item.id,
      property: params.payload.property,
      keyframeId: params.payload.axis === 'y' ? `${target.id}:y` : target.id,
    }
  }

  const resolved = resolveAnimatedTransform(
    params.baseTransform,
    itemKeyframes,
    params.payload.frame,
    {
      globalFrame: params.item.from + params.payload.frame,
      canvas: params.canvas,
      getItem: params.getItem,
      getKeyframes: params.getKeyframes,
    },
  )
  const resolvedValue =
    params.payload.vectorProperty === 'position'
      ? { x: resolved.x, y: resolved.y }
      : {
          x: toVectorScalePercent(resolved.width, params.baseTransform.width),
          y: toVectorScalePercent(resolved.height, params.baseTransform.height),
        }
  const keyframeId = timelineActions.upsertVectorKeyframe(
    params.item.id,
    params.payload.vectorProperty,
    {
      frame: params.payload.frame,
      value: { ...resolvedValue, [params.payload.axis]: params.payload.value },
      easing: params.payload.easing,
      easingConfig: params.payload.easingConfig,
    },
  )
  return keyframeId
    ? {
        itemId: params.item.id,
        property: params.payload.property,
        keyframeId: params.payload.axis === 'y' ? `${keyframeId}:y` : keyframeId,
      }
    : null
}

export function buildPasteSkipReasons(
  t: TFunction,
  skippedUnsupported: number,
  skippedBlocked: number,
): string[] {
  const reasons: string[] = []
  if (skippedUnsupported > 0) {
    reasons.push(t('timeline.keyframeEditor.reasonUnsupported', { count: skippedUnsupported }))
  }
  if (skippedBlocked > 0) {
    reasons.push(t('timeline.keyframeEditor.reasonBlocked', { count: skippedBlocked }))
  }
  return reasons
}

export function recordPromotedVectorDragIds(
  dragIds: Map<string, string>,
  property: VectorAnimatableProperty,
  identityRemap: ReturnType<typeof remapLegacyVectorPromotionIdentities>,
) {
  for (const [legacyEditorId, promotedStoredId] of identityRemap.storedIdByLegacyEditorId) {
    dragIds.set(`${property}:${legacyEditorId}`, promotedStoredId)
  }
}

export type KeyframeMoveEntry = { ref: KeyframeRef; newFrame: number; newValue: number }

export interface PendingVectorMove {
  property: VectorAnimatableProperty
  keyframeId: string
  frame: number
  value: { x: number; y: number }
}

export function promoteLegacyVectorEntryForMove(params: {
  entry: KeyframeMoveEntry
  itemId: string
  itemKeyframes: ItemKeyframes | null | undefined
  baseTransform: ResolvedTransform
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  selectedKeyframes: KeyframeRef[]
  storedIdByDragKey: Map<string, string>
  promotedDragIds: Map<string, string>
}): ReturnType<typeof remapLegacyVectorPromotionIdentities> | null {
  const { ref } = params.entry
  const proxy = getEditableVectorProxy(ref.property, params.itemKeyframes)
  if (!proxy) return null
  const dragKey = `${proxy.property}:${ref.keyframeId}`
  const storedId =
    params.storedIdByDragKey.get(dragKey) ?? getStoredVectorKeyframeId(ref.keyframeId, proxy.axis)
  const currentItemKeyframes = useKeyframesStore.getState().keyframesByItemId[params.itemId]
  if (findStoredVectorKeyframe(currentItemKeyframes, proxy.property, storedId)) return null
  const previewKeyframe = params.keyframesByProperty[ref.property]?.find(
    (keyframe) => keyframe.id === ref.keyframeId,
  )
  if (!previewKeyframe) return null
  const promotion = buildLegacyVectorPromotionAtFrame({
    property: proxy.property,
    itemKeyframes: currentItemKeyframes,
    baseTransform: params.baseTransform,
    frame: previewKeyframe.frame,
  })
  if (!promotion) return null
  const identityRemap = remapLegacyVectorPromotionIdentities({
    itemId: params.itemId,
    property: proxy.property,
    vectorKeyframes: promotion.plan.vectorProperty.keyframes,
    keyframesByProperty: params.keyframesByProperty,
    selectedKeyframes: params.selectedKeyframes,
  })
  recordPromotedVectorDragIds(params.storedIdByDragKey, proxy.property, identityRemap)
  recordPromotedVectorDragIds(params.promotedDragIds, proxy.property, identityRemap)
  useKeyframesStore
    .getState()
    ._replaceScalarPropertiesWithVectorProperty(
      params.itemId,
      promotion.plan.vectorProperty,
      promotion.plan.removeScalarProperties,
    )
  return identityRemap
}

function applyScalarKeyframeMove(
  entry: KeyframeMoveEntry,
  itemKeyframes: ItemKeyframes | undefined,
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>,
  updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: { frame: number; value: number },
  ) => void,
) {
  const { ref, newFrame, newValue } = entry
  const currentKeyframe = itemKeyframes?.properties
    .find((property) => property.property === ref.property)
    ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
  updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
    frame: clampFrameToBlockedRanges(
      Math.max(0, Math.round(newFrame)),
      currentKeyframe?.frame ?? newFrame,
      blockedRanges,
    ),
    value: newValue,
  })
}

function queueVectorKeyframeMove(params: {
  entry: KeyframeMoveEntry
  proxy: VectorPropertyProxy
  itemKeyframes: ItemKeyframes | undefined
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>
  storedIdByDragKey: Map<string, string>
  pendingMoves: Map<string, PendingVectorMove>
}) {
  const { ref, newFrame, newValue } = params.entry
  const dragKey = `${params.proxy.property}:${ref.keyframeId}`
  const storedId =
    params.storedIdByDragKey.get(dragKey) ??
    getStoredVectorKeyframeId(ref.keyframeId, params.proxy.axis)
  const currentKeyframe = findStoredVectorKeyframe(
    params.itemKeyframes,
    params.proxy.property,
    storedId,
  )
  if (!currentKeyframe) return
  const updateKey = `${params.proxy.property}:${storedId}`
  const pending = params.pendingMoves.get(updateKey)
  params.pendingMoves.set(updateKey, {
    property: params.proxy.property,
    keyframeId: storedId,
    frame: clampFrameToBlockedRanges(
      Math.max(0, Math.round(newFrame)),
      currentKeyframe.frame,
      params.blockedRanges,
    ),
    value: { ...(pending?.value ?? currentKeyframe.value), [params.proxy.axis]: newValue },
  })
}

export function applyKeyframeMoveEntry(params: {
  entry: KeyframeMoveEntry
  itemKeyframes: ItemKeyframes | undefined
  selectedItemKeyframes: ItemKeyframes | null | undefined
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>
  storedIdByDragKey: Map<string, string>
  pendingMoves: Map<string, PendingVectorMove>
  updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: { frame: number; value: number },
  ) => void
}) {
  const proxy = getEditableVectorProxy(params.entry.ref.property, params.selectedItemKeyframes)
  if (!proxy) {
    applyScalarKeyframeMove(
      params.entry,
      params.itemKeyframes,
      params.blockedRanges,
      params.updateKeyframe,
    )
    return
  }
  queueVectorKeyframeMove({
    entry: params.entry,
    proxy,
    itemKeyframes: params.itemKeyframes,
    blockedRanges: params.blockedRanges,
    storedIdByDragKey: params.storedIdByDragKey,
    pendingMoves: params.pendingMoves,
  })
}

export function clampFrameToBlockedRanges(
  frame: number,
  initialFrame: number,
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>,
): number {
  for (const range of blockedRanges) {
    if (frame >= range.start && frame < range.end) {
      if (initialFrame < range.start) return range.start - 1
      if (initialFrame >= range.end) return range.end
      const distToStart = frame - range.start
      const distToEnd = range.end - frame
      return distToStart < distToEnd ? range.start - 1 : range.end
    }
  }
  return frame
}


/**
 * Where the keyframe editor is docked: the default docked panel, the Edit
 * timeline's docked sheet, or the Animate workspace's motion workspace.
 */
export type KeyframeEditorSurface = 'default' | 'edit' | 'motion'

export function supportsVectorTransform(item: TimelineItem | null): item is TimelineItem {
  return Boolean(item && item.type !== 'audio' && item.type !== 'adjustment')
}

const EASINGS_WITH_EDITABLE_BEZIER = new Set<EasingType>([
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
])

export function getBezierEditorEasing(easing: EasingType | undefined): EasingType {
  return easing && EASINGS_WITH_EDITABLE_BEZIER.has(easing) ? easing : 'cubic-bezier'
}

export interface VectorEditorRow {
  property: VectorAnimatableProperty
  proxyProperty: 'x' | 'width' | 'anchorX'
  secondaryProxyProperty: 'y' | 'height' | 'anchorY'
  label: string
  value: { x: number; y: number }
  preExpressionValue: { x: number; y: number }
  unit: string
  keyframes: NonNullable<ItemKeyframes['vectorProperties']>[number]['keyframes']
  currentKeyframeId?: string
  persisted: boolean
}

function getPersistedVectorLane(
  itemKeyframes: ItemKeyframes | null | undefined,
  property: VectorAnimatableProperty,
) {
  return itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === property)
}

function getVectorEditorLane(
  property: VectorAnimatableProperty,
  itemKeyframes: ItemKeyframes | null | undefined,
  baseTransform: ResolvedTransform,
) {
  return (
    getPersistedVectorLane(itemKeyframes, property) ??
    buildVectorPromotionPlan({
      property,
      itemKeyframes: itemKeyframes ?? undefined,
      baseTransform,
      createId: (frame) => `legacy-${property}-${frame}`,
    }).vectorProperty
  )
}

function addVectorProxyKeyframes(
  result: Partial<Record<AnimatableProperty, Keyframe[]>>,
  itemKeyframes: ItemKeyframes | null | undefined,
  baseTransform: ResolvedTransform,
) {
  const lanes = {
    position: getVectorEditorLane('position', itemKeyframes, baseTransform),
    scale: getVectorEditorLane('scale', itemKeyframes, baseTransform),
    anchor: getVectorEditorLane('anchor', itemKeyframes, baseTransform),
  }
  result.x = resolveEditorScalarLane(itemKeyframes, 'position', 'x', 'x', lanes.position.keyframes)
  result.y = resolveEditorScalarLane(itemKeyframes, 'position', 'y', 'y', lanes.position.keyframes)
  result.width = resolveEditorScalarLane(
    itemKeyframes,
    'scale',
    'width',
    'x',
    lanes.scale.keyframes,
  )
  result.height = resolveEditorScalarLane(
    itemKeyframes,
    'scale',
    'height',
    'y',
    lanes.scale.keyframes,
  )
  result.anchorX = resolveEditorScalarLane(
    itemKeyframes,
    'anchor',
    'anchorX',
    'x',
    lanes.anchor.keyframes,
  )
  result.anchorY = resolveEditorScalarLane(
    itemKeyframes,
    'anchor',
    'anchorY',
    'y',
    lanes.anchor.keyframes,
  )
}

function trimEditorKeyframesToDuration(
  result: Partial<Record<AnimatableProperty, Keyframe[]>>,
  duration: number,
) {
  for (const property of Object.keys(result) as AnimatableProperty[]) {
    result[property] = result[property]?.filter((keyframe) => keyframe.frame < duration) ?? []
  }
}

export function buildEditorKeyframesByProperty(params: {
  properties: AnimatableProperty[]
  item: TimelineItem | null
  itemKeyframes: ItemKeyframes | null | undefined
  canvas: CanvasSettings
  trimToItemBounds: boolean
}): Partial<Record<AnimatableProperty, Keyframe[]>> {
  if (!params.item) return {}
  const stored = new Map(
    (params.itemKeyframes?.properties ?? []).map((property) => [
      property.property,
      property.keyframes,
    ]),
  )
  const result = Object.fromEntries(
    params.properties.map((property) => [property, stored.get(property) ?? []]),
  ) as Partial<Record<AnimatableProperty, Keyframe[]>>
  if (supportsVectorTransform(params.item)) {
    addVectorProxyKeyframes(
      result,
      params.itemKeyframes,
      resolveTransform(params.item, params.canvas, getSourceDimensions(params.item)),
    )
  }
  if (params.trimToItemBounds) trimEditorKeyframesToDuration(result, params.item.durationInFrames)
  return result
}

export function buildVectorControlRows(params: {
  itemKeyframes: ItemKeyframes | null | undefined
  base: ResolvedTransform
  resolved: ResolvedTransform
  preExpression: ResolvedTransform
  relativeFrame: number
  t: TFunction
}): VectorEditorRow[] {
  const positionLane = getVectorEditorLane('position', params.itemKeyframes, params.base)
  const scaleLane = getVectorEditorLane('scale', params.itemKeyframes, params.base)
  const anchorLane = getVectorEditorLane('anchor', params.itemKeyframes, params.base)
  return [
    {
      property: 'position',
      proxyProperty: 'x',
      secondaryProxyProperty: 'y',
      label: params.t('editor.layoutSection.position', { defaultValue: 'Position' }),
      value: { x: params.resolved.x, y: params.resolved.y },
      preExpressionValue: { x: params.preExpression.x, y: params.preExpression.y },
      unit: 'px',
      keyframes: positionLane.keyframes,
      currentKeyframeId: positionLane.keyframes.find(
        (keyframe) => keyframe.frame === params.relativeFrame,
      )?.id,
      persisted: Boolean(getPersistedVectorLane(params.itemKeyframes, 'position')),
    },
    {
      property: 'scale',
      proxyProperty: 'width',
      secondaryProxyProperty: 'height',
      label: params.t('editor.textProperties.scale', { defaultValue: 'Scale' }),
      value: {
        x: toVectorScalePercent(params.resolved.width, params.base.width),
        y: toVectorScalePercent(params.resolved.height, params.base.height),
      },
      preExpressionValue: {
        x: toVectorScalePercent(params.preExpression.width, params.base.width),
        y: toVectorScalePercent(params.preExpression.height, params.base.height),
      },
      unit: '%',
      keyframes: scaleLane.keyframes,
      currentKeyframeId: scaleLane.keyframes.find(
        (keyframe) => keyframe.frame === params.relativeFrame,
      )?.id,
      persisted: Boolean(getPersistedVectorLane(params.itemKeyframes, 'scale')),
    },
    {
      property: 'anchor',
      proxyProperty: 'anchorX',
      secondaryProxyProperty: 'anchorY',
      label: params.t('editor.layoutSection.anchor', { defaultValue: 'Anchor' }),
      value: { x: params.resolved.anchorX, y: params.resolved.anchorY },
      preExpressionValue: {
        x: params.preExpression.anchorX,
        y: params.preExpression.anchorY,
      },
      unit: 'px',
      keyframes: anchorLane.keyframes,
      currentKeyframeId: anchorLane.keyframes.find(
        (keyframe) => keyframe.frame === params.relativeFrame,
      )?.id,
      persisted: Boolean(getPersistedVectorLane(params.itemKeyframes, 'anchor')),
    },
  ]
}

export function filterVectorControlRows(
  rows: VectorEditorRow[],
  itemKeyframes: ItemKeyframes | null | undefined,
  surface: KeyframeEditorSurface | undefined,
  positionDimensionsSeparated: boolean,
): VectorEditorRow[] {
  if (surface !== 'edit') return rows
  const explicitlySeparated = new Set(itemKeyframes?.separatedVectorProperties ?? [])
  return rows.filter(
    (row) =>
      !explicitlySeparated.has(row.property) &&
      !(row.property === 'position' && positionDimensionsSeparated),
  )
}
