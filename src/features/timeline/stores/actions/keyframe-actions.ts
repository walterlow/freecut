/**
 * Keyframe Actions - Animation keyframe operations with undo/redo support.
 */

import type {
  AnimatableProperty,
  EasingType,
  Keyframe,
  KeyframeRef,
  DirectLinkableProperty,
  DirectPropertyLink,
  PropertyExpression,
  PropertyKeyframes,
  VectorAnimatableProperty,
  VectorKeyframe,
  VectorPropertyKeyframes,
  TransformAnimatableProperty,
} from '@/types/keyframe'
import type {
  KeyframeAddPayload,
  KeyframeUpdatePayload,
  VectorKeyframeInput,
} from '../keyframes-store'
import type { AutoKeyframeOperation } from '@/features/timeline/deps/keyframes'
import { useKeyframesStore } from '../keyframes-store'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, getLogger, canAddKeyframeAtFrame } from './shared'
import { cleanupTrimmedKeyframes } from '@/features/timeline/deps/keyframes'
import {
  hasTransformParentDependency,
  isTransformParentInheritedProperty,
  wouldCreateItemDependencyCycle,
} from '@/shared/utils/transform-parenting'

export function addKeyframe(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
  value: number,
  easing?: EasingType,
): string {
  // Validate: keyframes cannot be added in transition regions
  if (!canAddKeyframeAtFrame(itemId, frame)) {
    getLogger().warn('Cannot add keyframe in transition region', { itemId, property, frame })
    return ''
  }

  return execute(
    'ADD_KEYFRAME',
    () => {
      const id = useKeyframesStore.getState()._addKeyframe(itemId, property, frame, value, easing)
      useTimelineSettingsStore.getState().markDirty()
      return id
    },
    { itemId, property, frame },
  )
}

export function setDirectPropertyLink(itemId: string, link: DirectPropertyLink): void {
  const itemsState = useItemsStore.getState()
  const keyframesState = useKeyframesStore.getState()
  if (
    link.enabled &&
    (wouldCreateItemDependencyCycle(
      itemId,
      link.sourceItemId,
      (candidateId) => itemsState.itemById[candidateId],
      (candidateId) => keyframesState.keyframesByItemId[candidateId],
    ) ||
      (isTransformParentInheritedProperty(link.targetProperty) &&
        hasTransformParentDependency(
          itemId,
          link.sourceItemId,
          (candidateId) => itemsState.itemById[candidateId],
        )))
  ) {
    getLogger().warn('Cannot create a cyclic or redundant property link', {
      itemId,
      property: link.targetProperty,
      sourceItemId: link.sourceItemId,
      sourceProperty: link.sourceProperty,
    })
    return
  }

  execute(
    'SET_DIRECT_PROPERTY_LINK',
    () => {
      useKeyframesStore.getState()._setDirectPropertyLink(itemId, link)
      useTimelineSettingsStore.getState().markDirty()
    },
    {
      itemId,
      property: link.targetProperty,
      sourceItemId: link.sourceItemId,
      sourceProperty: link.sourceProperty,
    },
  )
}

export function removeDirectPropertyLink(itemId: string, property: DirectLinkableProperty): void {
  execute(
    'REMOVE_DIRECT_PROPERTY_LINK',
    () => {
      useKeyframesStore.getState()._removeDirectPropertyLink(itemId, property)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property },
  )
}

export function setPropertyExpression(itemId: string, expression: PropertyExpression): void {
  execute(
    'SET_PROPERTY_EXPRESSION',
    () => {
      useKeyframesStore.getState()._setPropertyExpression(itemId, expression)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property: expression.targetProperty, enabled: expression.enabled },
  )
}

export function removePropertyExpression(itemId: string, property: DirectLinkableProperty): void {
  execute(
    'REMOVE_PROPERTY_EXPRESSION',
    () => {
      useKeyframesStore.getState()._removePropertyExpression(itemId, property)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property },
  )
}

/** Add or replace a coupled Position/Scale keyframe in Animation Core v2. */
export function upsertVectorKeyframe(
  itemId: string,
  property: VectorAnimatableProperty,
  input: VectorKeyframeInput,
): string {
  if (!canAddKeyframeAtFrame(itemId, input.frame)) {
    getLogger().warn('Cannot add vector keyframe in transition region', {
      itemId,
      property,
      frame: input.frame,
    })
    return ''
  }

  return execute(
    'UPSERT_VECTOR_KEYFRAME',
    () => {
      const id = useKeyframesStore.getState()._upsertVectorKeyframe(itemId, property, input)
      useTimelineSettingsStore.getState().markDirty()
      return id
    },
    { itemId, property, frame: input.frame },
  )
}

export function updateVectorKeyframe(
  itemId: string,
  property: VectorAnimatableProperty,
  keyframeId: string,
  updates: Partial<Omit<VectorKeyframe, 'id'>>,
): void {
  if (typeof updates.frame === 'number' && !canAddKeyframeAtFrame(itemId, updates.frame)) {
    getLogger().warn('Cannot move vector keyframe into transition region', {
      itemId,
      property,
      keyframeId,
      frame: updates.frame,
    })
    return
  }

  execute(
    'UPDATE_VECTOR_KEYFRAME',
    () => {
      useKeyframesStore.getState()._updateVectorKeyframe(itemId, property, keyframeId, updates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

export function removeVectorKeyframe(
  itemId: string,
  property: VectorAnimatableProperty,
  keyframeId: string,
): void {
  execute(
    'REMOVE_VECTOR_KEYFRAME',
    () => {
      useKeyframesStore.getState()._removeVectorKeyframe(itemId, property, keyframeId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

/** Replace legacy scalar transform lanes with one coupled v2 vector lane. */
export function promoteTransformToVector(
  itemId: string,
  vectorProperty: VectorPropertyKeyframes,
  removeScalarProperties: readonly TransformAnimatableProperty[],
): void {
  execute(
    'PROMOTE_TRANSFORM_TO_VECTOR',
    () => {
      useKeyframesStore
        .getState()
        ._replaceScalarPropertiesWithVectorProperty(itemId, vectorProperty, removeScalarProperties)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property: vectorProperty.property },
  )
}

export function setVectorDimensionsSeparated(
  itemId: string,
  property: VectorAnimatableProperty,
  separated: boolean,
  conversion: {
    scalarProperties?: readonly PropertyKeyframes[]
    vectorProperty?: VectorPropertyKeyframes
  } = {},
): void {
  execute(
    separated ? 'SEPARATE_VECTOR_DIMENSIONS' : 'COMBINE_VECTOR_DIMENSIONS',
    () => {
      useKeyframesStore.getState()._setVectorDimensionsSeparated(itemId, property, {
        separated,
        ...conversion,
      })
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, separated },
  )
}

/**
 * Add multiple keyframes at once (batched as single undo operation).
 * Keyframes in transition regions are filtered out.
 */
export function addKeyframes(payloads: KeyframeAddPayload[]): string[] {
  if (payloads.length === 0) return []

  // Filter out keyframes that would be placed in transition regions
  const validPayloads = payloads.filter((p) => canAddKeyframeAtFrame(p.itemId, p.frame))

  if (validPayloads.length === 0) {
    getLogger().warn('All keyframes blocked by transition regions', {
      originalCount: payloads.length,
    })
    return []
  }

  if (validPayloads.length < payloads.length) {
    getLogger().warn('Some keyframes blocked by transition regions', {
      originalCount: payloads.length,
      validCount: validPayloads.length,
    })
  }

  return execute(
    'ADD_KEYFRAMES',
    () => {
      const ids = useKeyframesStore.getState()._addKeyframes(validPayloads)
      useTimelineSettingsStore.getState().markDirty()
      return ids
    },
    { count: validPayloads.length },
  )
}

/**
 * One property to clear before a preset applies. With `fromFrame`/`toFrame` only
 * keyframes inside that window are removed (region-aware Replace — a new entrance
 * preset clears the entrance window across all preset-owned properties while an
 * exit at the other end survives); without a range the whole property is cleared.
 */
export interface MotionPresetClear {
  itemId: string
  property: AnimatableProperty
  fromFrame?: number
  toFrame?: number
}

export interface MotionPresetVectorApply {
  itemId: string
  property: VectorAnimatableProperty
  keyframes: VectorKeyframeInput[]
  /** Present for Replace region; absent for collision-safe Merge. */
  replaceRange?: { fromFrame: number; toFrame: number }
}

const VECTOR_SCALAR_PROPERTIES: Record<
  VectorAnimatableProperty,
  readonly [TransformAnimatableProperty, TransformAnimatableProperty]
> = {
  position: ['x', 'y'],
  scale: ['width', 'height'],
  anchor: ['anchorX', 'anchorY'],
}

/**
 * Apply a motion preset's keyframes, optionally clearing target properties first
 * so reapplying a preset REPLACES the previous one instead of silently
 * overwriting only the frames that collide. The clear + add run inside a single
 * undo block so one Ctrl+Z reverts the whole apply.
 */
export function applyMotionPresetKeyframes(
  payloads: KeyframeAddPayload[],
  clearProperties: MotionPresetClear[] = [],
  vectorApplies: MotionPresetVectorApply[] = [],
): string[] {
  if (payloads.length === 0 && vectorApplies.length === 0) return []

  const validPayloads = payloads.filter((p) => canAddKeyframeAtFrame(p.itemId, p.frame))
  const vectorFrames = vectorApplies.flatMap((apply) =>
    apply.keyframes.map((keyframe) => ({ itemId: apply.itemId, frame: keyframe.frame })),
  )
  const validVectorFrames = vectorFrames.filter((entry) =>
    canAddKeyframeAtFrame(entry.itemId, entry.frame),
  )
  // All-or-nothing: if ANY payload is blocked (e.g. lands in a transition
  // region), abort before the clear loop runs. The clear windows are derived
  // from the pre-filtered set, so clearing while only some replacements survive
  // would silently delete keyframes we can't re-add. A partial apply must be a
  // no-op instead.
  if (validPayloads.length < payloads.length || validVectorFrames.length < vectorFrames.length) {
    getLogger().warn('Preset keyframes blocked by transition regions; skipping apply', {
      originalCount: payloads.length,
      validCount: validPayloads.length,
      vectorCount: vectorFrames.length,
      validVectorCount: validVectorFrames.length,
    })
    return []
  }

  return execute(
    'APPLY_MOTION_PRESET_KEYFRAMES',
    () => {
      const keyframesStore = useKeyframesStore.getState()
      for (const clear of clearProperties) {
        if (clear.fromFrame === undefined || clear.toFrame === undefined) {
          keyframesStore._removeKeyframesForProperty(clear.itemId, clear.property)
          continue
        }
        const group = keyframesStore.keyframesByItemId[clear.itemId]?.properties.find(
          (entry) => entry.property === clear.property,
        )
        if (!group) continue
        const refs = group.keyframes
          .filter((kf) => kf.frame >= clear.fromFrame! && kf.frame <= clear.toFrame!)
          .map((kf) => ({ itemId: clear.itemId, property: clear.property, keyframeId: kf.id }))
        if (refs.length > 0) keyframesStore._removeKeyframes(refs)
      }
      const ids = keyframesStore._addKeyframes(validPayloads)
      for (const apply of vectorApplies) {
        const existing =
          keyframesStore.keyframesByItemId[apply.itemId]?.vectorProperties?.find(
            (candidate) => candidate.property === apply.property,
          )?.keyframes ?? []
        const byFrame = new Map(
          existing
            .filter(
              (keyframe) =>
                !apply.replaceRange ||
                keyframe.frame < apply.replaceRange.fromFrame ||
                keyframe.frame > apply.replaceRange.toFrame,
            )
            .map((keyframe) => [keyframe.frame, keyframe]),
        )
        for (const input of apply.keyframes) {
          // Merge keeps an existing authored Vector2 diamond at collisions.
          if (!apply.replaceRange && byFrame.has(input.frame)) continue
          const existingAtFrame = byFrame.get(input.frame)
          const id = existingAtFrame?.id ?? crypto.randomUUID()
          byFrame.set(input.frame, {
            id,
            frame: input.frame,
            value: input.value,
            easing: input.easing ?? 'linear',
            easingConfig: input.easingConfig,
            temporalEase: input.temporalEase,
            spatial: input.spatial,
            source: input.source,
          })
          ids.push(id)
        }
        keyframesStore._replaceScalarPropertiesWithVectorProperty(
          apply.itemId,
          {
            property: apply.property,
            keyframes: [...byFrame.values()].sort((left, right) => left.frame - right.frame),
          },
          VECTOR_SCALAR_PROPERTIES[apply.property],
        )
      }
      useTimelineSettingsStore.getState().markDirty()
      return ids
    },
    {
      count: validPayloads.length + vectorFrames.length,
      cleared: clearProperties.length,
      vectorApplies: vectorApplies.length,
    },
  )
}

export function updateKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string,
  updates: Partial<Omit<Keyframe, 'id'>>,
): void {
  if (typeof updates.frame === 'number' && !canAddKeyframeAtFrame(itemId, updates.frame)) {
    getLogger().warn('Cannot move keyframe into transition region', {
      itemId,
      property,
      keyframeId,
      frame: updates.frame,
    })
    return
  }

  execute(
    'UPDATE_KEYFRAME',
    () => {
      useKeyframesStore.getState()._updateKeyframe(itemId, property, keyframeId, updates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

export function updateKeyframes(updates: KeyframeUpdatePayload[]): void {
  if (updates.length === 0) return

  const validUpdates = updates.filter((update) => {
    if (typeof update.updates.frame !== 'number') {
      return true
    }

    const allowed = canAddKeyframeAtFrame(update.itemId, update.updates.frame)
    if (!allowed) {
      getLogger().warn('Cannot move keyframe into transition region', {
        itemId: update.itemId,
        property: update.property,
        keyframeId: update.keyframeId,
        frame: update.updates.frame,
      })
    }
    return allowed
  })

  if (validUpdates.length === 0) return

  execute(
    'UPDATE_KEYFRAMES',
    () => {
      useKeyframesStore.getState()._updateKeyframes(validUpdates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: validUpdates.length },
  )
}

/**
 * Apply mixed auto-keyframe operations (adds + updates) in a single undo block.
 */
export function applyAutoKeyframeOperations(operations: AutoKeyframeOperation[]): void {
  if (operations.length === 0) return

  execute(
    'APPLY_AUTO_KEYFRAME_OPERATIONS',
    () => {
      const keyframesStore = useKeyframesStore.getState()
      let changed = false

      for (const operation of operations) {
        if (operation.type === 'vector-update') {
          keyframesStore._updateVectorKeyframe(
            operation.itemId,
            operation.property,
            operation.keyframeId,
            operation.updates,
          )
          changed = true
          continue
        }

        if (operation.type === 'vector-add') {
          if (!canAddKeyframeAtFrame(operation.itemId, operation.frame)) {
            getLogger().warn('Cannot add vector auto keyframe in transition region', {
              itemId: operation.itemId,
              property: operation.property,
              frame: operation.frame,
            })
            continue
          }
          keyframesStore._upsertVectorKeyframe(operation.itemId, operation.property, {
            frame: operation.frame,
            value: operation.value,
            easing: operation.easing,
          })
          changed = true
          continue
        }

        if (operation.type === 'update') {
          keyframesStore._updateKeyframe(
            operation.itemId,
            operation.property,
            operation.keyframeId,
            operation.updates,
          )
          changed = true
          continue
        }

        if (!canAddKeyframeAtFrame(operation.itemId, operation.frame)) {
          getLogger().warn('Cannot add auto keyframe in transition region', {
            itemId: operation.itemId,
            property: operation.property,
            frame: operation.frame,
          })
          continue
        }

        keyframesStore._addKeyframe(
          operation.itemId,
          operation.property,
          operation.frame,
          operation.value,
          operation.easing,
        )
        changed = true
      }

      if (changed) {
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { count: operations.length },
  )
}

export function removeKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string,
): void {
  execute(
    'REMOVE_KEYFRAME',
    () => {
      useKeyframesStore.getState()._removeKeyframe(itemId, property, keyframeId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

export function removeKeyframesForItem(itemId: string): void {
  execute(
    'REMOVE_KEYFRAMES_FOR_ITEM',
    () => {
      useKeyframesStore.getState()._removeKeyframesForItem(itemId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId },
  )
}

export function removeKeyframesForProperty(itemId: string, property: AnimatableProperty): void {
  execute(
    'REMOVE_KEYFRAMES_FOR_PROPERTY',
    () => {
      useKeyframesStore.getState()._removeKeyframesForProperty(itemId, property)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property },
  )
}

export function removePresetKeyframeApplication(itemId: string, applicationId: string): void {
  execute(
    'REMOVE_PRESET_KEYFRAME_APPLICATION',
    () => {
      useKeyframesStore.getState()._removeKeyframesByApplication(itemId, applicationId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, applicationId },
  )
}

export function removeManualKeyframes(itemId: string): void {
  execute(
    'REMOVE_MANUAL_KEYFRAMES',
    () => {
      useKeyframesStore.getState()._removeManualKeyframes(itemId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId },
  )
}

/**
 * Explicitly remove keyframes parked beyond the item's current out point.
 * A boundary keyframe is inserted first so the final visible frame retains its
 * evaluated value. Ordinary trim actions intentionally never call this.
 */
export function trimAnimationToItemBounds(itemId: string): number {
  return execute(
    'TRIM_ANIMATION_TO_BOUNDS',
    () => {
      const item = useItemsStore.getState().itemById[itemId]
      const store = useKeyframesStore.getState()
      const itemKeyframes = store.getKeyframesForItem(itemId)
      if (!item || !itemKeyframes) return 0

      const result = cleanupTrimmedKeyframes(
        itemKeyframes,
        item.durationInFrames,
        useTimelineSettingsStore.getState().fps,
      )
      if (result.removedCount === 0) return 0

      store.setKeyframes(
        store.keyframes.map((candidate) =>
          candidate.itemId === itemId ? result.itemKeyframes : candidate,
        ),
      )
      useTimelineSettingsStore.getState().markDirty()
      return result.removedCount
    },
    { itemId },
  )
}

// Read-only keyframe helpers (no undo needed)
export function getKeyframesForItem(itemId: string) {
  return useKeyframesStore.getState().getKeyframesForItem(itemId)
}

export function hasKeyframesAtFrame(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
): boolean {
  return useKeyframesStore.getState().hasKeyframesAtFrame(itemId, property, frame)
}

/**
 * Remove multiple keyframes at once.
 */
export function removeKeyframes(refs: KeyframeRef[]): void {
  if (refs.length === 0) return

  execute(
    'REMOVE_KEYFRAMES',
    () => {
      useKeyframesStore.getState()._removeKeyframes(refs)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: refs.length },
  )
}
