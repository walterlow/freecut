import { create } from 'zustand'
import type {
  ItemKeyframes,
  AnimatableProperty,
  Keyframe,
  PropertyKeyframes,
  EasingType,
  EasingConfig,
  KeyframeRef,
  DirectLinkableProperty,
  DirectPropertyLink,
  PropertyExpression,
  Vector2,
  VectorAnimatableProperty,
  VectorKeyframe,
  VectorPropertyKeyframes,
  AnimationKeyframeSource,
} from '@/types/keyframe'
import {
  ANIMATION_CORE_VERSION,
  doDirectLinkTargetsConflict,
  getDirectPropertyLinks,
  getPropertyExpressions,
  getVectorAnimatablePropertyComponents,
} from '@/types/keyframe'

/**
 * Keyframes state - animation keyframes for timeline items.
 * Keyframes reference items by itemId - orphaned keyframes should be cleaned up
 * when items are deleted (handled by timeline-actions).
 */

interface KeyframesState {
  keyframes: ItemKeyframes[]
  keyframesByItemId: Record<string, ItemKeyframes>
}

/** Update payload for batch keyframe updates */
export interface KeyframeUpdatePayload {
  itemId: string
  property: AnimatableProperty
  keyframeId: string
  updates: Partial<Omit<Keyframe, 'id'>>
}

/** Move payload for repositioning keyframes */
interface KeyframeMovePayload {
  ref: KeyframeRef
  newFrame: number
}

/** Payload for batch adding keyframes */
export interface KeyframeAddPayload {
  itemId: string
  property: AnimatableProperty
  frame: number
  value: number
  easing?: EasingType
  easingConfig?: EasingConfig
  source?: AnimationKeyframeSource
}

export interface VectorKeyframeInput {
  frame: number
  value: Vector2
  easing?: EasingType
  easingConfig?: EasingConfig
  temporalEase?: VectorKeyframe['temporalEase']
  spatial?: VectorKeyframe['spatial']
  source?: AnimationKeyframeSource
}

interface VectorDimensionModeInput {
  separated: boolean
  scalarProperties?: readonly PropertyKeyframes[]
  vectorProperty?: VectorPropertyKeyframes
}

interface KeyframesActions {
  // Bulk setter for snapshot restore
  setKeyframes: (keyframes: ItemKeyframes[]) => void

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    frame: number,
    value: number,
    easing?: EasingType,
    easingConfig?: EasingConfig,
  ) => string
  _addKeyframes: (payloads: KeyframeAddPayload[]) => string[]
  _updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, 'id'>>,
  ) => void
  _removeKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string) => void
  _removeKeyframesForItem: (itemId: string) => void
  _removeKeyframesForItems: (itemIds: string[]) => void
  _removeKeyframesForProperty: (itemId: string, property: AnimatableProperty) => void
  _removeVectorKeyframesForProperty: (itemId: string, property: VectorAnimatableProperty) => void
  _removeKeyframesByApplication: (itemId: string, applicationId: string) => void
  _removeManualKeyframes: (itemId: string) => void
  _setDirectPropertyLink: (itemId: string, link: DirectPropertyLink) => void
  _removeDirectPropertyLink: (itemId: string, property: DirectLinkableProperty) => void
  _setPropertyExpression: (itemId: string, expression: PropertyExpression) => void
  _removePropertyExpression: (itemId: string, property: DirectLinkableProperty) => void
  _upsertVectorKeyframe: (
    itemId: string,
    property: VectorAnimatableProperty,
    input: VectorKeyframeInput,
  ) => string
  _updateVectorKeyframe: (
    itemId: string,
    property: VectorAnimatableProperty,
    keyframeId: string,
    updates: Partial<Omit<VectorKeyframe, 'id'>>,
  ) => void
  _removeVectorKeyframe: (
    itemId: string,
    property: VectorAnimatableProperty,
    keyframeId: string,
  ) => void
  _replaceScalarPropertiesWithVectorProperty: (
    itemId: string,
    vectorProperty: VectorPropertyKeyframes,
    removeScalarProperties: readonly AnimatableProperty[],
  ) => void
  _setVectorDimensionsSeparated: (
    itemId: string,
    property: VectorAnimatableProperty,
    input: VectorDimensionModeInput,
  ) => void
  _scaleKeyframesForItem: (itemId: string, oldDuration: number, newDuration: number) => void

  // Batch operations for multi-keyframe manipulation
  _updateKeyframes: (updates: KeyframeUpdatePayload[]) => void
  _moveKeyframes: (moves: KeyframeMovePayload[]) => void
  _removeKeyframes: (refs: KeyframeRef[]) => void
  _duplicateKeyframes: (
    refs: KeyframeRef[],
    frameOffset: number,
    targetItemId?: string,
    targetProperty?: AnimatableProperty,
  ) => string[]

  // Read-only helpers
  getKeyframesForItem: (itemId: string) => ItemKeyframes | undefined
  getKeyframeById: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
  ) => Keyframe | undefined
  getAllKeyframesForProperty: (itemId: string, property: AnimatableProperty) => Keyframe[]
  hasKeyframesAtFrame: (itemId: string, property: AnimatableProperty, frame: number) => boolean
  getVectorKeyframesForProperty: (
    itemId: string,
    property: VectorAnimatableProperty,
  ) => VectorKeyframe[]
}

function buildKeyframesByItemId(keyframes: ItemKeyframes[]): Record<string, ItemKeyframes> {
  const map: Record<string, ItemKeyframes> = {}
  for (const ik of keyframes) {
    map[ik.itemId] = ik
  }
  return map
}

function dedupeKeyframesByFrame<T extends { id: string; frame: number }>(
  keyframes: T[],
  preferredIds: ReadonlySet<string> = new Set(),
): T[] {
  const frameMap = new Map<number, T>()

  for (const keyframe of keyframes) {
    const existing = frameMap.get(keyframe.frame)
    if (!existing) {
      frameMap.set(keyframe.frame, keyframe)
      continue
    }

    const existingPreferred = preferredIds.has(existing.id)
    const nextPreferred = preferredIds.has(keyframe.id)
    if (nextPreferred || !existingPreferred) {
      frameMap.set(keyframe.frame, keyframe)
    }
  }

  return Array.from(frameMap.values()).sort((a, b) => a.frame - b.frame)
}

function hasStoredAnimation(itemKeyframes: ItemKeyframes): boolean {
  if (itemKeyframes.properties.some((property) => property.keyframes.length > 0)) return true
  if (itemKeyframes.vectorProperties?.some((property) => property.keyframes.length > 0)) {
    return true
  }

  const nonScalarAnimation = [
    itemKeyframes.separatedVectorProperties,
    itemKeyframes.propertyLinks,
    itemKeyframes.expressions,
  ]
  return nonScalarAnimation.some((entries) => entries !== undefined && entries.length > 0)
}

function scaleFrameKeyframes<T extends { id: string; frame: number }>(
  keyframes: T[],
  scaleFactor: number,
  maxFrame: number,
): T[] {
  const originalFrameById = new Map(keyframes.map((keyframe) => [keyframe.id, keyframe.frame]))
  const frameMap = new Map<number, T>()

  for (const keyframe of keyframes) {
    const scaled = {
      ...keyframe,
      frame: Math.min(maxFrame, Math.max(0, Math.round(keyframe.frame * scaleFactor))),
    }
    const existing = frameMap.get(scaled.frame)
    if (
      !existing ||
      (originalFrameById.get(scaled.id) ?? -1) > (originalFrameById.get(existing.id) ?? -1)
    ) {
      frameMap.set(scaled.frame, scaled)
    }
  }

  return Array.from(frameMap.values()).sort((left, right) => left.frame - right.frame)
}

export const useKeyframesStore = create<KeyframesState & KeyframesActions>()((set, get) => ({
  // State
  keyframes: [],
  keyframesByItemId: {},

  // Bulk setter
  setKeyframes: (keyframes) =>
    set({ keyframes, keyframesByItemId: buildKeyframesByItemId(keyframes) }),

  // Add keyframe
  _addKeyframe: (itemId, property, frame, value, easing = 'linear', easingConfig) => {
    const keyframeId = crypto.randomUUID()
    const newKeyframe: Keyframe = { id: keyframeId, frame, value, easing, easingConfig }
    let resultingId: string = keyframeId

    set((state) => {
      const existingItemKeyframes = state.keyframes.find((k) => k.itemId === itemId)

      if (existingItemKeyframes) {
        // Item already has keyframes
        const existingPropKeyframes = existingItemKeyframes.properties.find(
          (p) => p.property === property,
        )

        if (existingPropKeyframes) {
          // Property already has keyframes - check for existing at this frame
          const existingAtFrame = existingPropKeyframes.keyframes.find((k) => k.frame === frame)
          if (existingAtFrame) {
            resultingId = existingAtFrame.id
            // Update existing keyframe value
            return {
              keyframes: state.keyframes.map((ik) =>
                ik.itemId === itemId
                  ? {
                      ...ik,
                      animationVersion: ANIMATION_CORE_VERSION,
                      properties: ik.properties.map((pk) =>
                        pk.property === property
                          ? {
                              ...pk,
                              keyframes: pk.keyframes.map((k) =>
                                k.frame === frame ? { ...k, value, easing, easingConfig } : k,
                              ),
                            }
                          : pk,
                      ),
                    }
                  : ik,
              ),
            }
          }

          // Add new keyframe to existing property
          return {
            keyframes: state.keyframes.map((ik) =>
              ik.itemId === itemId
                ? {
                    ...ik,
                    animationVersion: ANIMATION_CORE_VERSION,
                    properties: ik.properties.map((pk) =>
                      pk.property === property
                        ? {
                            ...pk,
                            keyframes: [...pk.keyframes, newKeyframe].sort(
                              (a, b) => a.frame - b.frame,
                            ),
                          }
                        : pk,
                    ),
                  }
                : ik,
            ),
          }
        }

        // Add new property with first keyframe
        return {
          keyframes: state.keyframes.map((ik) =>
            ik.itemId === itemId
              ? {
                  ...ik,
                  animationVersion: ANIMATION_CORE_VERSION,
                  properties: [...ik.properties, { property, keyframes: [newKeyframe] }],
                }
              : ik,
          ),
        }
      }

      // Create new item keyframes entry
      return {
        keyframes: [
          ...state.keyframes,
          {
            itemId,
            animationVersion: ANIMATION_CORE_VERSION,
            properties: [{ property, keyframes: [newKeyframe] }],
          },
        ],
      }
    })

    return resultingId
  },

  // Add multiple keyframes at once for batch edits.
  _addKeyframes: (payloads) => {
    if (payloads.length === 0) return []

    const newIds: string[] = []

    set((state) => {
      let newKeyframes = [...state.keyframes]

      for (const payload of payloads) {
        const { itemId, property, frame, value, easing = 'linear', easingConfig, source } = payload
        const keyframeId = crypto.randomUUID()
        const newKeyframe: Keyframe = { id: keyframeId, frame, value, easing, easingConfig, source }
        const existingItemIndex = newKeyframes.findIndex((k) => k.itemId === itemId)

        if (existingItemIndex !== -1) {
          const existingItem = newKeyframes[existingItemIndex]!
          const existingPropIndex = existingItem.properties.findIndex(
            (p) => p.property === property,
          )

          if (existingPropIndex !== -1) {
            const existingProp = existingItem.properties[existingPropIndex]!
            // Check for existing keyframe at this frame
            const existingAtFrameIndex = existingProp.keyframes.findIndex((k) => k.frame === frame)

            if (existingAtFrameIndex !== -1) {
              // Update existing keyframe
              const updatedKeyframes = [...existingProp.keyframes]
              updatedKeyframes[existingAtFrameIndex] = {
                ...updatedKeyframes[existingAtFrameIndex]!,
                value,
                easing,
                easingConfig,
              }
              newIds.push(updatedKeyframes[existingAtFrameIndex]!.id)

              const updatedProperties = [...existingItem.properties]
              updatedProperties[existingPropIndex] = {
                ...existingProp,
                keyframes: updatedKeyframes,
              }

              newKeyframes = newKeyframes.map((ik, idx) =>
                idx === existingItemIndex
                  ? {
                      ...existingItem,
                      animationVersion: ANIMATION_CORE_VERSION,
                      properties: updatedProperties,
                    }
                  : ik,
              )
            } else {
              // Add new keyframe to existing property
              const updatedKeyframes = [...existingProp.keyframes, newKeyframe].sort(
                (a, b) => a.frame - b.frame,
              )
              newIds.push(keyframeId)

              const updatedProperties = [...existingItem.properties]
              updatedProperties[existingPropIndex] = {
                ...existingProp,
                keyframes: updatedKeyframes,
              }

              newKeyframes = newKeyframes.map((ik, idx) =>
                idx === existingItemIndex
                  ? {
                      ...existingItem,
                      animationVersion: ANIMATION_CORE_VERSION,
                      properties: updatedProperties,
                    }
                  : ik,
              )
            }
          } else {
            // Add new property with first keyframe
            const updatedProperties = [
              ...existingItem.properties,
              { property, keyframes: [newKeyframe] },
            ]
            newIds.push(keyframeId)

            newKeyframes = newKeyframes.map((ik, idx) =>
              idx === existingItemIndex
                ? {
                    ...existingItem,
                    animationVersion: ANIMATION_CORE_VERSION,
                    properties: updatedProperties,
                  }
                : ik,
            )
          }
        } else {
          // Create new item keyframes entry
          newIds.push(keyframeId)
          newKeyframes = [
            ...newKeyframes,
            {
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [{ property, keyframes: [newKeyframe] }],
            },
          ]
        }
      }

      return { keyframes: newKeyframes }
    })

    return newIds
  },

  // Update keyframe
  _updateKeyframe: (itemId, property, keyframeId, updates) =>
    set((state) => ({
      keyframes: state.keyframes.map((ik) =>
        ik.itemId === itemId
          ? {
              ...ik,
              properties: ik.properties.map((pk) =>
                pk.property === property
                  ? {
                      ...pk,
                      keyframes: dedupeKeyframesByFrame(
                        pk.keyframes.map((k) => (k.id === keyframeId ? { ...k, ...updates } : k)),
                        new Set([keyframeId]),
                      ),
                    }
                  : pk,
              ),
            }
          : ik,
      ),
    })),

  // Remove keyframe
  _removeKeyframe: (itemId, property, keyframeId) =>
    set((state) => ({
      keyframes: state.keyframes.map((ik) =>
        ik.itemId === itemId
          ? {
              ...ik,
              properties: ik.properties.map((pk) =>
                pk.property === property
                  ? {
                      ...pk,
                      keyframes: pk.keyframes.filter((k) => k.id !== keyframeId),
                    }
                  : pk,
              ),
            }
          : ik,
      ),
    })),

  // Remove all keyframes for an item
  _removeKeyframesForItem: (itemId) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                properties: [],
                ...(itemKeyframes.vectorProperties && { vectorProperties: [] }),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  // Remove keyframes for multiple items (cascade delete)
  _removeKeyframesForItems: (itemIds) =>
    set((state) => {
      const idsSet = new Set(itemIds)
      return {
        keyframes: state.keyframes
          .filter((itemKeyframes) => !idsSet.has(itemKeyframes.itemId))
          .map((itemKeyframes) => ({
            ...itemKeyframes,
            propertyLinks: itemKeyframes.propertyLinks?.filter(
              (link) => !idsSet.has(link.sourceItemId),
            ),
            expressions: itemKeyframes.expressions?.filter(
              (expression) => expression.type !== 'link' || !idsSet.has(expression.sourceItemId),
            ),
          }))
          .filter(hasStoredAnimation),
      }
    }),

  // Remove keyframes for a specific property
  _removeKeyframesForProperty: (itemId, property) =>
    set((state) => ({
      keyframes: state.keyframes.map((ik) =>
        ik.itemId === itemId
          ? {
              ...ik,
              properties: ik.properties.filter((pk) => pk.property !== property),
            }
          : ik,
      ),
    })),

  _removeVectorKeyframesForProperty: (itemId, property) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                vectorProperties: itemKeyframes.vectorProperties?.filter(
                  (candidate) => candidate.property !== property,
                ),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _removeKeyframesByApplication: (itemId, applicationId) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                properties: itemKeyframes.properties
                  .map((property) => ({
                    ...property,
                    keyframes: property.keyframes.filter(
                      (keyframe) => keyframe.source?.applicationId !== applicationId,
                    ),
                  }))
                  .filter((property) => property.keyframes.length > 0),
                vectorProperties: itemKeyframes.vectorProperties
                  ?.map((property) => ({
                    ...property,
                    keyframes: property.keyframes.filter(
                      (keyframe) => keyframe.source?.applicationId !== applicationId,
                    ),
                  }))
                  .filter((property) => property.keyframes.length > 0),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _removeManualKeyframes: (itemId) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                properties: itemKeyframes.properties
                  .map((property) => ({
                    ...property,
                    keyframes: property.keyframes.filter((keyframe) => keyframe.source),
                  }))
                  .filter((property) => property.keyframes.length > 0),
                vectorProperties: itemKeyframes.vectorProperties
                  ?.map((property) => ({
                    ...property,
                    keyframes: property.keyframes.filter((keyframe) => keyframe.source),
                  }))
                  .filter((property) => property.keyframes.length > 0),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _setDirectPropertyLink: (itemId, expression) =>
    set((state) => {
      const existing = state.keyframes.find((itemKeyframes) => itemKeyframes.itemId === itemId)
      if (!existing) {
        return {
          keyframes: [
            ...state.keyframes,
            {
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [],
              propertyLinks: [expression],
            },
          ],
        }
      }

      return {
        keyframes: state.keyframes.map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                animationVersion: ANIMATION_CORE_VERSION,
                propertyLinks: [
                  ...getDirectPropertyLinks(itemKeyframes).filter(
                    (candidate) =>
                      !doDirectLinkTargetsConflict(
                        candidate.targetProperty,
                        expression.targetProperty,
                      ),
                  ),
                  expression,
                ],
                expressions: [...getPropertyExpressions(itemKeyframes)],
              }
            : itemKeyframes,
        ),
      }
    }),

  _removeDirectPropertyLink: (itemId, property) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                propertyLinks: getDirectPropertyLinks(itemKeyframes).filter(
                  (link) => link.targetProperty !== property,
                ),
                expressions: [...getPropertyExpressions(itemKeyframes)],
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _setPropertyExpression: (itemId, expression) =>
    set((state) => {
      const existing = state.keyframes.find((itemKeyframes) => itemKeyframes.itemId === itemId)
      if (!existing) {
        return {
          keyframes: [
            ...state.keyframes,
            {
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [],
              expressions: [expression],
            },
          ],
        }
      }
      return {
        keyframes: state.keyframes.map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                animationVersion: ANIMATION_CORE_VERSION,
                propertyLinks: [...getDirectPropertyLinks(itemKeyframes)],
                expressions: [
                  ...getPropertyExpressions(itemKeyframes).filter(
                    (candidate) => candidate.targetProperty !== expression.targetProperty,
                  ),
                  expression,
                ],
              }
            : itemKeyframes,
        ),
      }
    }),

  _removePropertyExpression: (itemId, property) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                propertyLinks: [...getDirectPropertyLinks(itemKeyframes)],
                expressions: getPropertyExpressions(itemKeyframes).filter(
                  (expression) => expression.targetProperty !== property,
                ),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _upsertVectorKeyframe: (itemId, property, input) => {
    const newId = crypto.randomUUID()
    let resultingId: string = newId
    const newKeyframe: VectorKeyframe = {
      id: newId,
      frame: input.frame,
      value: input.value,
      easing: input.easing ?? 'linear',
      easingConfig: input.easingConfig,
      temporalEase: input.temporalEase,
      spatial: input.spatial,
      source: input.source,
    }

    set((state) => {
      const existingItem = state.keyframes.find((candidate) => candidate.itemId === itemId)
      if (!existingItem) {
        return {
          keyframes: [
            ...state.keyframes,
            {
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [],
              vectorProperties: [{ property, keyframes: [newKeyframe] }],
            },
          ],
        }
      }

      const existingProperty = existingItem.vectorProperties?.find(
        (candidate) => candidate.property === property,
      )
      const existingAtFrame = existingProperty?.keyframes.find(
        (keyframe) => keyframe.frame === input.frame,
      )
      if (existingAtFrame) resultingId = existingAtFrame.id

      return {
        keyframes: state.keyframes.map((itemKeyframes) => {
          if (itemKeyframes.itemId !== itemId) return itemKeyframes

          const vectorProperties = itemKeyframes.vectorProperties ?? []
          if (!existingProperty) {
            return {
              ...itemKeyframes,
              animationVersion: ANIMATION_CORE_VERSION,
              vectorProperties: [...vectorProperties, { property, keyframes: [newKeyframe] }],
            }
          }

          return {
            ...itemKeyframes,
            animationVersion: ANIMATION_CORE_VERSION,
            vectorProperties: vectorProperties.map((candidate) =>
              candidate.property === property
                ? {
                    ...candidate,
                    keyframes: existingAtFrame
                      ? candidate.keyframes.map((keyframe) =>
                          keyframe.frame === input.frame
                            ? { ...newKeyframe, id: keyframe.id }
                            : keyframe,
                        )
                      : [...candidate.keyframes, newKeyframe].sort(
                          (left, right) => left.frame - right.frame,
                        ),
                  }
                : candidate,
            ),
          }
        }),
      }
    })

    return resultingId
  },

  _updateVectorKeyframe: (itemId, property, keyframeId, updates) =>
    set((state) => ({
      keyframes: state.keyframes.map((itemKeyframes) =>
        itemKeyframes.itemId === itemId
          ? {
              ...itemKeyframes,
              animationVersion: ANIMATION_CORE_VERSION,
              vectorProperties: itemKeyframes.vectorProperties?.map((candidate) =>
                candidate.property === property
                  ? {
                      ...candidate,
                      keyframes: dedupeKeyframesByFrame(
                        candidate.keyframes.map((keyframe) =>
                          keyframe.id === keyframeId ? { ...keyframe, ...updates } : keyframe,
                        ),
                        new Set([keyframeId]),
                      ),
                    }
                  : candidate,
              ),
            }
          : itemKeyframes,
      ),
    })),

  _removeVectorKeyframe: (itemId, property, keyframeId) =>
    set((state) => ({
      keyframes: state.keyframes
        .map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                vectorProperties: itemKeyframes.vectorProperties?.map((candidate) =>
                  candidate.property === property
                    ? {
                        ...candidate,
                        keyframes: candidate.keyframes.filter(
                          (keyframe) => keyframe.id !== keyframeId,
                        ),
                      }
                    : candidate,
                ),
              }
            : itemKeyframes,
        )
        .filter(hasStoredAnimation),
    })),

  _replaceScalarPropertiesWithVectorProperty: (itemId, vectorProperty, removeScalarProperties) =>
    set((state) => {
      const removeSet = new Set(removeScalarProperties)
      const existing = state.keyframes.find((itemKeyframes) => itemKeyframes.itemId === itemId)
      if (!existing) {
        return {
          keyframes: [
            ...state.keyframes,
            {
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [],
              vectorProperties: [vectorProperty],
            },
          ],
        }
      }

      return {
        keyframes: state.keyframes.map((itemKeyframes) =>
          itemKeyframes.itemId === itemId
            ? {
                ...itemKeyframes,
                animationVersion: ANIMATION_CORE_VERSION,
                properties: itemKeyframes.properties.filter(
                  (property) => !removeSet.has(property.property),
                ),
                vectorProperties: [
                  ...(itemKeyframes.vectorProperties ?? []).filter(
                    (property) => property.property !== vectorProperty.property,
                  ),
                  vectorProperty,
                ],
              }
            : itemKeyframes,
        ),
      }
    }),

  _setVectorDimensionsSeparated: (itemId, property, input) =>
    set((state) => {
      const componentSet = new Set<AnimatableProperty>(
        getVectorAnimatablePropertyComponents(property),
      )
      const updateItemKeyframes = (itemKeyframes: ItemKeyframes): ItemKeyframes => {
        const separatedSet = new Set(itemKeyframes.separatedVectorProperties ?? [])
        if (input.separated) separatedSet.add(property)
        else separatedSet.delete(property)

        const scalarProperties = input.separated
          ? (input.scalarProperties ?? []).map((candidate) => ({
              ...candidate,
              keyframes: candidate.keyframes.map((keyframe) => ({ ...keyframe })),
            }))
          : []
        const vectorProperties = (itemKeyframes.vectorProperties ?? []).filter(
          (candidate) => candidate.property !== property,
        )
        if (!input.separated && input.vectorProperty) {
          vectorProperties.push(input.vectorProperty)
        }

        return {
          ...itemKeyframes,
          animationVersion: ANIMATION_CORE_VERSION,
          properties: [
            ...itemKeyframes.properties.filter(
              (candidate) => !componentSet.has(candidate.property),
            ),
            ...scalarProperties,
          ],
          vectorProperties,
          separatedVectorProperties: Array.from(separatedSet),
        }
      }

      const existing = state.keyframes.find((candidate) => candidate.itemId === itemId)
      if (!existing) {
        return {
          keyframes: [
            ...state.keyframes,
            updateItemKeyframes({
              itemId,
              animationVersion: ANIMATION_CORE_VERSION,
              properties: [],
            }),
          ],
        }
      }

      return {
        keyframes: state.keyframes.map((candidate) =>
          candidate.itemId === itemId ? updateItemKeyframes(candidate) : candidate,
        ),
      }
    }),

  // Scale keyframes when item duration changes (rate stretch)
  // Scales frame positions proportionally: newFrame = oldFrame * (newDuration / oldDuration)
  // Handles edge cases:
  // - Clamps keyframes to valid range [0, newDuration - 1]
  // - Merges colliding keyframes (keeps the one with higher original frame)
  // - Preserves keyframe at frame 0
  _scaleKeyframesForItem: (itemId, oldDuration, newDuration) => {
    // Skip if no change or invalid values
    if (oldDuration === newDuration || oldDuration <= 0 || newDuration <= 0) return

    const scaleFactor = newDuration / oldDuration
    const maxFrame = newDuration - 1

    set((state) => {
      const itemKeyframes = state.keyframes.find((k) => k.itemId === itemId)
      if (!itemKeyframes) return state

      return {
        keyframes: state.keyframes.map((ik) => {
          if (ik.itemId !== itemId) return ik

          return {
            ...ik,
            properties: ik.properties.map((pk) => {
              if (pk.keyframes.length === 0) return pk
              return {
                ...pk,
                keyframes: scaleFrameKeyframes(pk.keyframes, scaleFactor, maxFrame),
              }
            }),
            vectorProperties: ik.vectorProperties?.map((property) => ({
              ...property,
              keyframes: scaleFrameKeyframes(property.keyframes, scaleFactor, maxFrame),
            })),
          }
        }),
      }
    })
  },

  // Batch update multiple keyframes at once
  _updateKeyframes: (updates) => {
    if (updates.length === 0) return

    const preferredIdsByKey = new Map<string, Set<string>>()
    for (const update of updates) {
      const key = `${update.itemId}:${update.property}`
      if (!preferredIdsByKey.has(key)) {
        preferredIdsByKey.set(key, new Set())
      }
      preferredIdsByKey.get(key)!.add(update.keyframeId)
    }

    set((state) => {
      let newKeyframes = [...state.keyframes]

      for (const update of updates) {
        newKeyframes = newKeyframes.map((ik) =>
          ik.itemId === update.itemId
            ? {
                ...ik,
                properties: ik.properties.map((pk) =>
                  pk.property === update.property
                    ? {
                        ...pk,
                        keyframes: dedupeKeyframesByFrame(
                          pk.keyframes.map((k) =>
                            k.id === update.keyframeId ? { ...k, ...update.updates } : k,
                          ),
                          preferredIdsByKey.get(`${update.itemId}:${update.property}`) ?? new Set(),
                        ),
                      }
                    : pk,
                ),
              }
            : ik,
        )
      }

      return { keyframes: newKeyframes }
    })
  },

  // Move keyframes to new frame positions
  _moveKeyframes: (moves) => {
    if (moves.length === 0) return

    // Convert to update payloads
    const updates: KeyframeUpdatePayload[] = moves.map((move) => ({
      itemId: move.ref.itemId,
      property: move.ref.property,
      keyframeId: move.ref.keyframeId,
      updates: { frame: Math.max(0, move.newFrame) },
    }))

    get()._updateKeyframes(updates)
  },

  // Remove multiple keyframes at once
  _removeKeyframes: (refs) => {
    if (refs.length === 0) return

    // Group refs by item and property for efficient removal
    const refsByItemAndProp = new Map<string, Set<string>>()
    for (const ref of refs) {
      const key = `${ref.itemId}:${ref.property}`
      if (!refsByItemAndProp.has(key)) {
        refsByItemAndProp.set(key, new Set())
      }
      refsByItemAndProp.get(key)!.add(ref.keyframeId)
    }

    set((state) => ({
      keyframes: state.keyframes.map((ik) => ({
        ...ik,
        properties: ik.properties.map((pk) => {
          const key = `${ik.itemId}:${pk.property}`
          const toRemove = refsByItemAndProp.get(key)
          if (!toRemove) return pk

          return {
            ...pk,
            keyframes: pk.keyframes.filter((k) => !toRemove.has(k.id)),
          }
        }),
      })),
    }))
  },

  // Duplicate keyframes with frame offset
  _duplicateKeyframes: (refs, frameOffset, targetItemId, targetProperty) => {
    if (refs.length === 0) return []

    const newIds: string[] = []
    const state = get()

    // Gather source keyframe data
    const toDuplicate: Array<{
      property: AnimatableProperty
      keyframe: Keyframe
      targetItemId: string
    }> = []

    for (const ref of refs) {
      const itemKeyframes = state.keyframes.find((k) => k.itemId === ref.itemId)
      if (!itemKeyframes) continue

      const propKeyframes = itemKeyframes.properties.find((p) => p.property === ref.property)
      if (!propKeyframes) continue

      const keyframe = propKeyframes.keyframes.find((k) => k.id === ref.keyframeId)
      if (!keyframe) continue

      toDuplicate.push({
        property: targetProperty ?? ref.property,
        keyframe,
        targetItemId: targetItemId ?? ref.itemId,
      })
    }

    // Add duplicated keyframes
    for (const { property, keyframe, targetItemId: destItemId } of toDuplicate) {
      const newId = state._addKeyframe(
        destItemId,
        property,
        keyframe.frame + frameOffset,
        keyframe.value,
        keyframe.easing,
        keyframe.easingConfig,
      )
      newIds.push(newId)
    }

    return newIds
  },

  // Read-only: Get keyframes for an item (O(1) via index)
  getKeyframesForItem: (itemId) => {
    return get().keyframesByItemId[itemId]
  },

  // Read-only: Get a specific keyframe by ID
  getKeyframeById: (itemId, property, keyframeId) => {
    const itemKeyframes = get().keyframesByItemId[itemId]
    if (!itemKeyframes) return undefined

    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property)
    if (!propKeyframes) return undefined

    return propKeyframes.keyframes.find((k) => k.id === keyframeId)
  },

  // Read-only: Get all keyframes for a property
  getAllKeyframesForProperty: (itemId, property) => {
    const itemKeyframes = get().keyframesByItemId[itemId]
    if (!itemKeyframes) return []

    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property)
    if (!propKeyframes) return []

    return propKeyframes.keyframes
  },

  // Read-only: Check if keyframe exists at frame
  hasKeyframesAtFrame: (itemId, property, frame) => {
    const itemKeyframes = get().keyframesByItemId[itemId]
    if (!itemKeyframes) return false

    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property)
    if (!propKeyframes) return false

    return propKeyframes.keyframes.some((k) => k.frame === frame)
  },

  getVectorKeyframesForProperty: (itemId, property) => {
    return (
      get().keyframesByItemId[itemId]?.vectorProperties?.find(
        (candidate) => candidate.property === property,
      )?.keyframes ?? []
    )
  },
}))

// Auto-rebuild keyframesByItemId index whenever keyframes array changes.
// This avoids modifying every individual setter while keeping O(1) lookups.
useKeyframesStore.subscribe((state, prevState) => {
  if (
    state.keyframes !== prevState.keyframes &&
    state.keyframesByItemId === prevState.keyframesByItemId
  ) {
    useKeyframesStore.setState({ keyframesByItemId: buildKeyframesByItemId(state.keyframes) })
  }
})
