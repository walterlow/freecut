/**
 * Animated transform resolver.
 * Merges keyframe-animated values with base transform properties.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import type {
  DirectLinkableProperty,
  ItemKeyframes,
  LinkableAnimatableProperty,
  TransformAnimatableProperty,
  Vector2,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import {
  areDirectLinkPropertiesCompatible,
  getDirectPropertyLinks,
  getPropertyExpressions,
  isShapeAnimatableProperty,
  isTransformAnimatableProperty,
  isVectorAnimatableProperty,
} from '@/types/keyframe'
import { getSourceDimensions, resolveTransform } from '../deps/composition-runtime-contract'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import { getShapeAnimatableBaseValue } from './shape-animatable-properties'
import { getVectorPropertyKeyframes, interpolateVectorPropertyValue } from './vector-interpolation'
import {
  evaluatePropertyExpression,
  isExpressionValueCompatible,
  type ExpressionValue,
  type PropertyExpressionResult,
} from './property-expression'

/**
 * All animatable transform properties (excludes non-spatial props like volume).
 */
const ANIMATABLE_TRANSFORM_PROPERTIES: TransformAnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
]

export interface LinkedPropertyEvaluationContext {
  /** Composition frame, shared by the target and every linked source. */
  globalFrame: number
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
  /** Transient visual transform for live gizmo/property scrubs. */
  getPreviewTransform?: (itemId: string) => Partial<ResolvedTransform> | undefined
}

interface LinkedTransformEvaluationState {
  cache: Map<string, number>
  vectorCache: Map<string, Vector2>
  expressionCache: Map<string, ExpressionValue>
  active: Set<string>
}

function getPreExpressionValue(
  item: TimelineItem,
  property: LinkableAnimatableProperty,
  context: LinkedPropertyEvaluationContext,
): number | null {
  let base: number
  if (isTransformAnimatableProperty(property)) {
    const resolved = resolveAnimatedTransform(
      resolveTransform(item, context.canvas, getSourceDimensions(item)),
      context.getKeyframes(item.id),
      context.globalFrame - item.from,
    )
    return resolved[property]
  } else if (isShapeAnimatableProperty(property) && item.type === 'shape') {
    base = getShapeAnimatableBaseValue(item, property)
  } else {
    return null
  }
  const keyframes = getPropertyKeyframes(context.getKeyframes(item.id), property)
  const relativeFrame = context.globalFrame - item.from
  return interpolatePropertyValue(keyframes, relativeFrame, base)
}

export function resolveLinkedPropertyValue(
  itemId: string,
  property: LinkableAnimatableProperty,
  preExpressionValue: number,
  context: LinkedPropertyEvaluationContext,
  state: LinkedTransformEvaluationState = {
    cache: new Map(),
    vectorCache: new Map(),
    expressionCache: new Map(),
    active: new Set(),
  },
): number {
  const dependencyKey = `${itemId}:${property}`
  const cacheKey = `${dependencyKey}@${context.globalFrame}`
  const cached = state.cache.get(cacheKey)
  if (cached !== undefined) return cached

  // Imported or legacy projects can contain a cycle even though the UI blocks
  // creating one. Fall back to the property's pre-expression value rather than
  // recursing forever or poisoning the rendered frame with NaN.
  if (state.active.has(dependencyKey)) return preExpressionValue

  const link = getDirectPropertyLinks(context.getKeyframes(itemId)).find(
    (candidate) => candidate.targetProperty === property && candidate.enabled,
  )
  if (!link) {
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }

  const sourceItem = context.getItem(link.sourceItemId)
  if (!sourceItem) {
    // Broken references are non-fatal and leave the target's authored value in
    // place. The UI can still expose the broken link for repair or removal.
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }

  state.active.add(dependencyKey)
  const sourceContext =
    link.timeOffsetFrames === 0
      ? context
      : {
          ...context,
          globalFrame: context.globalFrame - link.timeOffsetFrames,
          getPreviewTransform: undefined,
        }
  if (isVectorAnimatableProperty(link.sourceProperty)) {
    state.active.delete(dependencyKey)
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }
  const sourcePreExpressionValue = getPreExpressionValue(
    sourceItem,
    link.sourceProperty,
    sourceContext,
  )
  if (sourcePreExpressionValue === null) {
    state.active.delete(dependencyKey)
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }
  const linkedValue = resolveLinkedPropertyValue(
    sourceItem.id,
    link.sourceProperty,
    sourcePreExpressionValue,
    sourceContext,
    state,
  )
  const value = getPreviewedScalarLinkValue(
    sourceItem.id,
    link.sourceProperty,
    linkedValue,
    sourceContext,
  )
  state.active.delete(dependencyKey)
  state.cache.set(cacheKey, value)
  return value
}

function getPreLinkVectorValue(
  item: TimelineItem,
  property: VectorAnimatableProperty,
  context: LinkedPropertyEvaluationContext,
): Vector2 {
  const base = resolveTransform(item, context.canvas, getSourceDimensions(item))
  const resolved = resolveAnimatedTransform(
    base,
    context.getKeyframes(item.id),
    context.globalFrame - item.from,
  )
  if (property === 'position') return { x: resolved.x, y: resolved.y }
  if (property === 'anchor') return { x: resolved.anchorX, y: resolved.anchorY }
  return {
    x: base.width === 0 ? 100 : (resolved.width / base.width) * 100,
    y: base.height === 0 ? 100 : (resolved.height / base.height) * 100,
  }
}

function getPreviewedScalarLinkValue(
  itemId: string,
  property: LinkableAnimatableProperty,
  fallback: number,
  context: LinkedPropertyEvaluationContext,
): number {
  if (!isTransformAnimatableProperty(property)) return fallback
  const previewValue = context.getPreviewTransform?.(itemId)?.[property]
  return typeof previewValue === 'number' ? previewValue : fallback
}

function getPreviewedVectorLinkValue(
  item: TimelineItem,
  property: VectorAnimatableProperty,
  fallback: Vector2,
  context: LinkedPropertyEvaluationContext,
): Vector2 {
  const preview = context.getPreviewTransform?.(item.id)
  if (!preview) return fallback
  if (property === 'position') return getPreviewedPositionValue(preview, fallback)
  if (property === 'anchor') return getPreviewedAnchorValue(preview, fallback)
  return getPreviewedScaleValue(item, preview, fallback, context.canvas)
}

function getPreviewedPositionValue(
  preview: Partial<ResolvedTransform>,
  fallback: Vector2,
): Vector2 {
  return {
    x: preview.x ?? fallback.x,
    y: preview.y ?? fallback.y,
  }
}

function getPreviewedAnchorValue(preview: Partial<ResolvedTransform>, fallback: Vector2): Vector2 {
  return {
    x: preview.anchorX ?? fallback.x,
    y: preview.anchorY ?? fallback.y,
  }
}

function getPreviewedScaleValue(
  item: TimelineItem,
  preview: Partial<ResolvedTransform>,
  fallback: Vector2,
  canvas: CanvasSettings,
): Vector2 {
  const base = resolveTransform(item, canvas, getSourceDimensions(item))
  return {
    x: getPreviewedScaleAxisValue(preview.width, fallback.x, base.width),
    y: getPreviewedScaleAxisValue(preview.height, fallback.y, base.height),
  }
}

function getPreviewedScaleAxisValue(
  preview: number | undefined,
  fallback: number,
  base: number,
): number {
  if (preview === undefined || base === 0) return fallback
  return (preview / base) * 100
}

function resolveLinkedVectorValue(
  itemId: string,
  property: VectorAnimatableProperty,
  preLinkValue: Vector2,
  context: LinkedPropertyEvaluationContext,
  state: LinkedTransformEvaluationState,
): Vector2 {
  const dependencyKey = `${itemId}:${property}`
  const cacheKey = `${dependencyKey}@${context.globalFrame}`
  const cached = state.vectorCache.get(cacheKey)
  if (cached) return cached
  if (state.active.has(dependencyKey)) return preLinkValue

  const link = getDirectPropertyLinks(context.getKeyframes(itemId)).find(
    (candidate) => candidate.targetProperty === property && candidate.enabled,
  )
  if (!link || !isVectorAnimatableProperty(link.sourceProperty)) {
    state.vectorCache.set(cacheKey, preLinkValue)
    return preLinkValue
  }
  const sourceItem = context.getItem(link.sourceItemId)
  if (!sourceItem) {
    state.vectorCache.set(cacheKey, preLinkValue)
    return preLinkValue
  }

  state.active.add(dependencyKey)
  const sourceContext =
    link.timeOffsetFrames === 0
      ? context
      : {
          ...context,
          globalFrame: context.globalFrame - link.timeOffsetFrames,
          getPreviewTransform: undefined,
        }
  const sourcePreLinkValue = getPreLinkVectorValue(sourceItem, link.sourceProperty, sourceContext)
  const linkedValue = resolveLinkedVectorValue(
    sourceItem.id,
    link.sourceProperty,
    sourcePreLinkValue,
    sourceContext,
    state,
  )
  const value = getPreviewedVectorLinkValue(
    sourceItem,
    link.sourceProperty,
    linkedValue,
    sourceContext,
  )
  state.active.delete(dependencyKey)
  state.vectorCache.set(cacheKey, value)
  return value
}

function resolveReferencedExpressionProperty(
  itemId: string,
  property: DirectLinkableProperty,
  context: LinkedPropertyEvaluationContext,
  state: LinkedTransformEvaluationState,
): ExpressionValue | null {
  const item = context.getItem(itemId)
  if (!item) return null
  if (isVectorAnimatableProperty(property)) {
    const preLinkValue = getPreLinkVectorValue(item, property, context)
    const postLinkValue = resolveLinkedVectorValue(item.id, property, preLinkValue, context, state)
    return resolvePropertyExpressionValue(item.id, property, postLinkValue, context, state).value
  }
  const preLinkValue = getPreExpressionValue(item, property, context)
  if (preLinkValue === null) return null
  const postLinkValue = resolveLinkedPropertyValue(item.id, property, preLinkValue, context, state)
  return resolvePropertyExpressionValue(item.id, property, postLinkValue, context, state).value
}

export function resolveExpressionReferenceValue(
  itemId: string,
  property: DirectLinkableProperty,
  context: LinkedPropertyEvaluationContext,
): ExpressionValue | null {
  return resolveReferencedExpressionProperty(itemId, property, context, {
    cache: new Map(),
    vectorCache: new Map(),
    expressionCache: new Map(),
    active: new Set(),
  })
}

/** Evaluate a stored expression after keyframes and direct links. */
export function resolvePropertyExpressionValue(
  itemId: string,
  property: DirectLinkableProperty,
  preExpressionValue: ExpressionValue,
  context: LinkedPropertyEvaluationContext,
  state: LinkedTransformEvaluationState = {
    cache: new Map(),
    vectorCache: new Map(),
    expressionCache: new Map(),
    active: new Set(),
  },
): PropertyExpressionResult {
  const expression = getPropertyExpressions(context.getKeyframes(itemId)).find(
    (candidate) => candidate.targetProperty === property && candidate.enabled,
  )
  if (!expression) return { value: preExpressionValue }
  const dependencyKey = `expression:${itemId}:${property}`
  const cacheKey = `${dependencyKey}@${context.globalFrame}`
  const cached = state.expressionCache.get(cacheKey)
  if (cached !== undefined) return { value: cached }
  if (state.active.has(dependencyKey)) {
    return { value: preExpressionValue, error: 'Expression dependency cycle' }
  }

  state.active.add(dependencyKey)
  const result = evaluatePropertyExpression(expression.source, {
    preValue: preExpressionValue,
    globalFrame: context.globalFrame,
    fps: context.canvas.fps,
    resolveProperty: (sourceItemId, sourceProperty) =>
      resolveReferencedExpressionProperty(sourceItemId, sourceProperty, context, state),
  })
  state.active.delete(dependencyKey)
  if (result.error || !isExpressionValueCompatible(property, result.value)) {
    return {
      value: preExpressionValue,
      error: result.error ?? 'Expression result has the wrong value type',
    }
  }
  state.expressionCache.set(cacheKey, result.value)
  return result
}

interface VectorTransformAnimation {
  result: ResolvedTransform
  hasPosition: boolean
  hasScale: boolean
  hasAnchor: boolean
}

function resolveVectorTransformAnimation(
  baseResolved: ResolvedTransform,
  itemKeyframes: ItemKeyframes,
  frame: number,
  fps: number | undefined,
): VectorTransformAnimation {
  const result = { ...baseResolved }
  const positionKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'position')
  const scaleKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'scale')
  const anchorKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'anchor')

  if (positionKeyframes.length > 0) {
    const position = interpolateVectorPropertyValue(
      'position',
      positionKeyframes,
      frame,
      { x: baseResolved.x, y: baseResolved.y },
      fps,
    )
    result.x = position.x
    result.y = position.y
  }

  if (scaleKeyframes.length > 0) {
    const scale = interpolateVectorPropertyValue(
      'scale',
      scaleKeyframes,
      frame,
      { x: 100, y: 100 },
      fps,
    )
    result.width = baseResolved.width * (scale.x / 100)
    result.height = baseResolved.height * (scale.y / 100)
  }

  if (anchorKeyframes.length > 0) {
    const anchor = interpolateVectorPropertyValue(
      'anchor',
      anchorKeyframes,
      frame,
      { x: baseResolved.anchorX, y: baseResolved.anchorY },
      fps,
    )
    result.anchorX = anchor.x
    result.anchorY = anchor.y
  }

  return {
    result,
    hasPosition: positionKeyframes.length > 0,
    hasScale: scaleKeyframes.length > 0,
    hasAnchor: anchorKeyframes.length > 0,
  }
}

function isControlledByVectorAnimation(
  property: TransformAnimatableProperty,
  vectorAnimation: Pick<VectorTransformAnimation, 'hasPosition' | 'hasScale' | 'hasAnchor'>,
): boolean {
  if (vectorAnimation.hasPosition && (property === 'x' || property === 'y')) return true
  if (vectorAnimation.hasScale && (property === 'width' || property === 'height')) return true
  return vectorAnimation.hasAnchor && (property === 'anchorX' || property === 'anchorY')
}

function getVectorTransformValue(
  property: VectorAnimatableProperty,
  baseResolved: ResolvedTransform,
  vectorAnimation: VectorTransformAnimation,
): Vector2 {
  if (property === 'position') {
    return { x: vectorAnimation.result.x, y: vectorAnimation.result.y }
  }
  if (property === 'anchor') {
    return { x: vectorAnimation.result.anchorX, y: vectorAnimation.result.anchorY }
  }
  return {
    x: baseResolved.width === 0 ? 100 : (vectorAnimation.result.width / baseResolved.width) * 100,
    y:
      baseResolved.height === 0 ? 100 : (vectorAnimation.result.height / baseResolved.height) * 100,
  }
}

function applyVectorTransformValue(
  property: VectorAnimatableProperty,
  value: Vector2,
  baseResolved: ResolvedTransform,
  vectorAnimation: VectorTransformAnimation,
): void {
  if (property === 'position') {
    vectorAnimation.result.x = value.x
    vectorAnimation.result.y = value.y
    vectorAnimation.hasPosition = true
    return
  }
  if (property === 'anchor') {
    vectorAnimation.result.anchorX = value.x
    vectorAnimation.result.anchorY = value.y
    vectorAnimation.hasAnchor = true
    return
  }
  vectorAnimation.result.width = baseResolved.width * (value.x / 100)
  vectorAnimation.result.height = baseResolved.height * (value.y / 100)
  vectorAnimation.hasScale = true
}

function applyVectorPropertyLinks(params: {
  baseResolved: ResolvedTransform
  itemKeyframes: ItemKeyframes
  vectorAnimation: VectorTransformAnimation
  context: LinkedPropertyEvaluationContext
  state: LinkedTransformEvaluationState
}): void {
  const { baseResolved, itemKeyframes, vectorAnimation, context, state } = params
  for (const property of ['position', 'scale', 'anchor'] as const) {
    const hasLink = getDirectPropertyLinks(itemKeyframes).some(
      (candidate) => candidate.targetProperty === property && candidate.enabled,
    )
    if (!hasLink) continue
    const preLinkValue = getVectorTransformValue(property, baseResolved, vectorAnimation)
    const value = resolveLinkedVectorValue(
      itemKeyframes.itemId,
      property,
      preLinkValue,
      context,
      state,
    )
    applyVectorTransformValue(property, value, baseResolved, vectorAnimation)
  }
}

function applyVectorPropertyExpressions(params: {
  baseResolved: ResolvedTransform
  itemKeyframes: ItemKeyframes
  vectorAnimation: VectorTransformAnimation
  context: LinkedPropertyEvaluationContext
  state: LinkedTransformEvaluationState
}): void {
  const { baseResolved, itemKeyframes, vectorAnimation, context, state } = params
  for (const property of ['position', 'scale', 'anchor'] as const) {
    const hasExpression = getPropertyExpressions(itemKeyframes).some(
      (candidate) => candidate.targetProperty === property && candidate.enabled,
    )
    if (!hasExpression) continue
    const preExpressionValue = getVectorTransformValue(property, baseResolved, vectorAnimation)
    const result = resolvePropertyExpressionValue(
      itemKeyframes.itemId,
      property,
      preExpressionValue,
      context,
      state,
    ).value
    if (typeof result === 'number') continue
    applyVectorTransformValue(property, result, baseResolved, vectorAnimation)
  }
}

function resolveScalarTransformProperty(params: {
  property: TransformAnimatableProperty
  baseResolved: ResolvedTransform
  vectorAnimation: VectorTransformAnimation
  itemKeyframes: ItemKeyframes
  frame: number
  expressionContext: LinkedPropertyEvaluationContext | undefined
  expressionState: LinkedTransformEvaluationState
}): number {
  const {
    property,
    baseResolved,
    vectorAnimation,
    itemKeyframes,
    frame,
    expressionContext,
    expressionState,
  } = params
  const keyframes = getPropertyKeyframes(itemKeyframes, property)
  const controlledByVector = isControlledByVectorAnimation(property, vectorAnimation)
  const baseValue = controlledByVector ? vectorAnimation.result[property] : baseResolved[property]
  const preExpressionValue = controlledByVector
    ? baseValue
    : interpolatePropertyValue(keyframes, frame, baseValue)

  if (expressionContext) {
    const postLinkValue = resolveLinkedPropertyValue(
      itemKeyframes.itemId,
      property,
      preExpressionValue,
      expressionContext,
      expressionState,
    )
    const expressionResult = resolvePropertyExpressionValue(
      itemKeyframes.itemId,
      property,
      postLinkValue,
      expressionContext,
      expressionState,
    ).value
    return typeof expressionResult === 'number' ? expressionResult : postLinkValue
  }
  return keyframes.length > 0 ? preExpressionValue : vectorAnimation.result[property]
}

/**
 * Resolve an animated transform at a specific frame.
 * Merges keyframe-animated values with the base resolved transform.
 *
 * @param baseResolved - The base resolved transform (without animation)
 * @param itemKeyframes - All keyframes for the item
 * @param frame - Current frame relative to item start
 * @returns ResolvedTransform with animated values applied
 */
export function resolveAnimatedTransform(
  baseResolved: ResolvedTransform,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  expressionContext?: LinkedPropertyEvaluationContext,
): ResolvedTransform {
  // No animation data - return base transform unchanged.
  if (!itemKeyframes) {
    return baseResolved
  }

  const vectorAnimation = resolveVectorTransformAnimation(
    baseResolved,
    itemKeyframes,
    frame,
    expressionContext?.canvas.fps,
  )

  const expressionState: LinkedTransformEvaluationState = {
    cache: new Map(),
    vectorCache: new Map(),
    expressionCache: new Map(),
    active: new Set(),
  }

  if (expressionContext) {
    applyVectorPropertyLinks({
      baseResolved,
      itemKeyframes,
      vectorAnimation,
      context: expressionContext,
      state: expressionState,
    })
    applyVectorPropertyExpressions({
      baseResolved,
      itemKeyframes,
      vectorAnimation,
      context: expressionContext,
      state: expressionState,
    })
  }

  // Keyframes produce the pre-expression value. A valid link then replaces it
  // with the source property's post-expression value at composition time.
  for (const property of ANIMATABLE_TRANSFORM_PROPERTIES) {
    vectorAnimation.result[property] = resolveScalarTransformProperty({
      property,
      baseResolved,
      vectorAnimation,
      itemKeyframes,
      frame,
      expressionContext,
      expressionState,
    })
  }

  return vectorAnimation.result
}

/**
 * Check if an item has any keyframe animations.
 *
 * @param itemKeyframes - All keyframes for the item
 * @returns True if the item has at least one keyframe
 */
export function hasKeyframeAnimation(itemKeyframes: ItemKeyframes | undefined): boolean {
  if (!itemKeyframes) return false
  return (
    itemKeyframes.properties.some((p) => p.keyframes.length > 0) ||
    (itemKeyframes.vectorProperties?.some((property) => property.keyframes.length > 0) ?? false) ||
    getDirectPropertyLinks(itemKeyframes).some((link) => link.enabled) ||
    (itemKeyframes.expressions?.some(
      (expression) => expression.type === 'expression' && expression.enabled,
    ) ??
      false)
  )
}

/** Return the direct link for a target property, including disabled links. */
function getDirectPropertyLink(
  itemKeyframes: ItemKeyframes | undefined,
  property: DirectLinkableProperty,
) {
  return getDirectPropertyLinks(itemKeyframes).find((link) => link.targetProperty === property)
}

/**
 * Check whether adding `candidate` would introduce a dependency cycle. Broken
 * existing references are ignored because they cannot lead back to the target.
 */
export function wouldCreateDirectPropertyLinkCycle(
  itemId: string,
  property: DirectLinkableProperty,
  sourceItemId: string,
  sourceProperty: DirectLinkableProperty,
  getKeyframes: (candidateItemId: string) => ItemKeyframes | undefined,
): boolean {
  const targetKey = `${itemId}:${property}`
  let currentItemId = sourceItemId
  let currentProperty = sourceProperty
  const visited = new Set<string>()

  while (true) {
    const key = `${currentItemId}:${currentProperty}`
    if (key === targetKey) return true
    if (visited.has(key)) return false
    visited.add(key)

    const next = getDirectPropertyLink(getKeyframes(currentItemId), currentProperty)
    if (
      !next?.enabled ||
      !areDirectLinkPropertiesCompatible(currentProperty, next.sourceProperty)
    ) {
      return false
    }
    currentItemId = next.sourceItemId
    currentProperty = next.sourceProperty
  }
}
