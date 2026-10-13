/**
 * Item Actions - Cross-domain operations that affect items, transitions, and keyframes.
 */

import type { ControllerItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type {
  CanvasSettings,
  ResolvedTransform,
  TransformParentBinding,
  TransformParentingBehavior,
} from '@/types/transform'
import type {
  DirectPropertyLink,
  EasingConfig,
  ItemKeyframes,
  Keyframe,
  PropertyKeyframes,
  StoredPropertyExpression,
  VectorKeyframe,
  VectorPropertyKeyframes,
} from '@/types/keyframe'
import type { Transition } from '@/types/transition'
import type { ReverseConformResult } from '../../services/reverse-conform-service'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { emitUiSound } from '@/shared/ui/ui-sound'
import { execute, applyTransitionRepairs, warnIfOverlapping } from './shared'
import { buildLinkedLeftShiftUpdates, expandIdsWithLinkedItems } from './linked-edit'
import { propagateRemovedIntervalsToSyncLockedTracks } from './sync-lock-ripple'
import {
  canLinkSelection,
  expandSelectionWithLinkedItems,
  getLinkedItemIds,
  getSynchronizedLinkedItems,
} from '../../utils/linked-items'
import { isTrackSyncLockEnabled } from '../../utils/track-sync-lock'
import { pruneEmptyLayerGroupHierarchy } from '../../utils/group-utils'
import { placeItemsWithoutTimelineOverlap } from './item-placement'
import { useReverseConformDialogStore } from '../reverse-conform-dialog-store'
import { buildLinkedAudioForVideo } from '../../utils/embedded-audio-split'
import {
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
} from '@/features/timeline/deps/composition-runtime'
import {
  createTransformParentBinding,
  hasRedundantTransformParentLink,
  wouldCreateTransformParentCycle,
} from '@/shared/utils/transform-parenting'
import { createDefaultControllerItem } from '../../utils/generated-layer-items'

function isLinkedSelectionEnabled(): boolean {
  return useEditorStore.getState().linkedSelectionEnabled
}

function pruneLayerGroupsAfterItemRemoval(): void {
  const store = useItemsStore.getState()
  const nextTracks = pruneEmptyLayerGroupHierarchy(store.tracks, store.items)
  if (nextTracks !== store.tracks) {
    store.setTracks(nextTracks)
  }
}

function canParticipateInTransformHierarchy(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'adjustment'
}

type TransformParentUpdateContext = {
  parentItemId?: string
  parentWorld?: ResolvedTransform
  behavior: TransformParentingBehavior
  frame: number
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}

type TransformParentUpdateResult =
  | { status: 'invalid' | 'unchanged' }
  | { status: 'update'; binding: TransformParentBinding | undefined }

function getTransformParentEarlyResult(
  childItemId: string,
  child: TimelineItem | undefined,
  context: TransformParentUpdateContext,
): TransformParentUpdateResult | null {
  if (isInvalidTransformParentUpdate(childItemId, child, context)) return { status: 'invalid' }
  if (isUnchangedPreserveWorldParent(child, context)) return { status: 'unchanged' }
  if (!context.parentItemId && context.behavior === 'restore-local') {
    return child?.transformParent
      ? { status: 'update', binding: undefined }
      : { status: 'unchanged' }
  }
  return null
}

function isInvalidTransformParentUpdate(
  childItemId: string,
  child: TimelineItem | undefined,
  context: TransformParentUpdateContext,
): boolean {
  if (!child || !canParticipateInTransformHierarchy(child)) return true
  return Boolean(
    context.parentItemId &&
    (wouldCreateTransformParentCycle(
      childItemId,
      context.parentItemId,
      context.getItem,
      context.getKeyframes,
    ) ||
      hasRedundantTransformParentLink(
        childItemId,
        context.parentItemId,
        context.getItem,
        context.getKeyframes,
      )),
  )
}

function isUnchangedPreserveWorldParent(
  child: TimelineItem | undefined,
  context: TransformParentUpdateContext,
): boolean {
  return (
    context.behavior === 'preserve-world' &&
    child?.transformParent?.parentItemId === context.parentItemId
  )
}

function chooseChildWorldReference(
  behavior: TransformParentingBehavior,
  childWorld: ResolvedTransform,
  childLocal: ResolvedTransform,
  parentWorld: ResolvedTransform | undefined,
): ResolvedTransform {
  if (behavior === 'snap-to-parent' && parentWorld) {
    return { ...childWorld, x: parentWorld.x, y: parentWorld.y }
  }
  return behavior === 'restore-local' ? childLocal : childWorld
}

function buildTransformParentUpdate(
  childItemId: string,
  context: TransformParentUpdateContext,
): TransformParentUpdateResult {
  const { parentItemId, parentWorld, behavior, frame, canvas, getItem, getKeyframes } = context
  const child = getItem(childItemId)
  const earlyResult = getTransformParentEarlyResult(childItemId, child, context)
  if (earlyResult) return earlyResult
  if (!child) return { status: 'invalid' }

  const childKeyframes = getKeyframes(child.id)
  const childWorld = resolveItemTransformAtFrame(child, {
    canvas,
    frame,
    keyframes: childKeyframes,
    getItem,
    getKeyframes,
  })
  const childLocal = resolveItemTransformAtRelativeFrame(child, {
    canvas,
    relativeFrame: frame - child.from,
    keyframes: childKeyframes,
    expressionContext: { globalFrame: frame, canvas, getItem, getKeyframes },
  })
  const childWorldReference = chooseChildWorldReference(
    behavior,
    childWorld,
    childLocal,
    parentWorld,
  )
  return {
    status: 'update',
    binding: createTransformParentBinding({
      childLocal,
      childWorld: childWorldReference,
      parentItemId,
      parentWorld,
    }),
  }
}

function isValidTransformParentRequest(
  childItemIds: string[],
  parentItemId: string | undefined,
  parent: TimelineItem | undefined,
): boolean {
  if (childItemIds.length === 0) return false
  if (parentItemId && childItemIds.includes(parentItemId)) return false
  if (!parentItemId) return true
  return Boolean(parent && canParticipateInTransformHierarchy(parent))
}

function commitTransformParentUpdates(
  updates: Map<string, TransformParentBinding | undefined>,
  parentItemId: string | undefined,
): boolean {
  if (updates.size === 0) return false
  return execute(
    updates.size === 1 ? 'SET_TRANSFORM_PARENT' : 'SET_TRANSFORM_PARENTS',
    () => {
      for (const [childItemId, transformParent] of updates) {
        useItemsStore.getState()._updateItem(childItemId, { transformParent })
      }
      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { childItemIds: [...updates.keys()], parentItemId: parentItemId ?? null },
  )
}

function collectTransformParentUpdates(
  childItemIds: string[],
  context: TransformParentUpdateContext,
): Map<string, TransformParentBinding | undefined> | null {
  const updates = new Map<string, TransformParentBinding | undefined>()
  for (const childItemId of childItemIds) {
    const result = buildTransformParentUpdate(childItemId, context)
    if (result.status === 'invalid') return null
    if (result.status === 'update') updates.set(childItemId, result.binding)
  }
  return updates
}

function createTransformParentUpdateContext(params: {
  parentItemId?: string
  parent?: TimelineItem
  behavior?: TransformParentingBehavior
  frame: number
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}): TransformParentUpdateContext {
  const {
    parentItemId,
    parent,
    behavior = 'preserve-world',
    frame,
    canvas,
    getItem,
    getKeyframes,
  } = params
  const parentWorld = parent
    ? resolveItemTransformAtFrame(parent, {
        canvas,
        frame,
        keyframes: getKeyframes(parent.id),
        getItem,
        getKeyframes,
      })
    : undefined
  return { parentItemId, parentWorld, behavior, frame, canvas, getItem, getKeyframes }
}

function getUniqueNullObjectLabel(items: TimelineItem[]): string {
  const baseLabel = 'Null Object'
  const labels = new Set(items.map((item) => item.label))
  if (!labels.has(baseLabel)) return baseLabel
  let suffix = 2
  while (labels.has(`${baseLabel} ${suffix}`)) suffix += 1
  return `${baseLabel} ${suffix}`
}

function getNullParentTrackPlacement(
  children: TimelineItem[],
  tracks: TimelineTrack[],
): { order: number; parentTrackId?: string } {
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const childTracks = children
    .map((item) => trackById.get(item.trackId))
    .filter((track): track is TimelineTrack => Boolean(track))
  if (childTracks.length === 0) {
    return { order: tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1 }
  }

  const parentTrackIds = new Set(childTracks.map((track) => track.parentTrackId ?? null))
  const parentTrackId =
    parentTrackIds.size === 1 ? (childTracks[0]?.parentTrackId ?? undefined) : undefined
  const anchors =
    parentTrackIds.size === 1
      ? childTracks
      : childTracks.map(
          (track) => (track.parentTrackId && trackById.get(track.parentTrackId)) || track,
        )
  const siblingTracks = tracks.filter(
    (track) => (track.parentTrackId ?? null) === (parentTrackId ?? null),
  )
  const anchorOrders = anchors
    .filter((track) => (track.parentTrackId ?? null) === (parentTrackId ?? null))
    .map((track) => track.order)
  const order =
    anchorOrders.length > 0
      ? Math.min(...anchorOrders)
      : siblingTracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
  return { order, ...(parentTrackId && { parentTrackId }) }
}

function createNullParentLayer(params: {
  children: TimelineItem[]
  items: TimelineItem[]
  tracks: TimelineTrack[]
  canvas: CanvasSettings
}): { parent: ControllerItem; track: TimelineTrack } {
  const { children, items, tracks, canvas } = params
  const trackId = crypto.randomUUID()
  const from = Math.min(...children.map((item) => item.from))
  const to = Math.max(...children.map((item) => item.from + item.durationInFrames))
  const label = getUniqueNullObjectLabel(items)
  const placement = getNullParentTrackPlacement(children, tracks)
  const parent = createDefaultControllerItem({
    trackId,
    from,
    durationInFrames: Math.max(1, to - from),
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    fps: canvas.fps,
  })
  parent.label = label
  const track: TimelineTrack = {
    id: trackId,
    name: label,
    kind: 'video',
    height: 34,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order: placement.order,
    ...(placement.parentTrackId && { parentTrackId: placement.parentTrackId }),
    items: [],
  }
  return { parent, track }
}

/** Attach, detach, or reparent visual layers with an explicit pose policy. */
export function setTransformParents(params: {
  childItemIds: string[]
  parentItemId?: string
  behavior?: TransformParentingBehavior
  frame: number
  canvas: CanvasSettings
}): boolean {
  const { parentItemId, frame, canvas } = params
  const childItemIds = [...new Set(params.childItemIds)]
  const itemsStore = useItemsStore.getState()
  const parent = parentItemId ? itemsStore.itemById[parentItemId] : undefined
  if (!isValidTransformParentRequest(childItemIds, parentItemId, parent)) return false
  const getItem = (itemId: string) => itemsStore.itemById[itemId]
  const keyframesStore = useKeyframesStore.getState()
  const getKeyframes = (itemId: string) => keyframesStore.keyframesByItemId[itemId]
  const context = createTransformParentUpdateContext({
    parentItemId,
    parent,
    behavior: params.behavior,
    frame,
    canvas,
    getItem,
    getKeyframes,
  })
  const updates = collectTransformParentUpdates(childItemIds, context)
  if (!updates) return false

  return commitTransformParentUpdates(updates, parentItemId)
}

/** Create one Null Object spanning the selected layers and parent them in one undo step. */
export function createNullParentForItems(params: {
  childItemIds: string[]
  frame: number
  canvas: CanvasSettings
}): ControllerItem | null {
  const childItemIds = [...new Set(params.childItemIds)]
  const itemsStore = useItemsStore.getState()
  const children = childItemIds.map((itemId) => itemsStore.itemById[itemId])
  if (
    children.length === 0 ||
    children.some((item) => !item || !canParticipateInTransformHierarchy(item))
  ) {
    return null
  }

  const { parent, track } = createNullParentLayer({
    children: children as TimelineItem[],
    items: itemsStore.items,
    tracks: itemsStore.tracks,
    canvas: params.canvas,
  })
  const getItem = (itemId: string) =>
    itemId === parent.id ? parent : useItemsStore.getState().itemById[itemId]
  const keyframesStore = useKeyframesStore.getState()
  const getKeyframes = (itemId: string) => keyframesStore.keyframesByItemId[itemId]
  const context = createTransformParentUpdateContext({
    parentItemId: parent.id,
    parent,
    frame: params.frame,
    canvas: params.canvas,
    getItem,
    getKeyframes,
  })
  const updates = collectTransformParentUpdates(childItemIds, context)
  if (!updates || updates.size !== childItemIds.length) return null

  return execute(
    'CREATE_NULL_PARENT',
    () => {
      const store = useItemsStore.getState()
      store.setTracks([
        ...store.tracks.map((candidate) =>
          (candidate.parentTrackId ?? null) === (track.parentTrackId ?? null) &&
          candidate.order >= track.order
            ? { ...candidate, order: candidate.order + 1 }
            : candidate,
        ),
        track,
      ])
      store._addItem(parent)
      for (const [childItemId, transformParent] of updates) {
        store._updateItem(childItemId, { transformParent })
      }
      useTimelineSettingsStore.getState().markDirty()
      return parent
    },
    { parentItemId: parent.id, childItemIds, trackId: track.id },
  )
}

/** Attach, detach, or reparent one visual layer while preserving its current world pose. */
export function setTransformParent(params: {
  childItemId: string
  parentItemId?: string
  behavior?: TransformParentingBehavior
  frame: number
  canvas: CanvasSettings
}): boolean {
  return setTransformParents({
    childItemIds: [params.childItemId],
    parentItemId: params.parentItemId,
    behavior: params.behavior,
    frame: params.frame,
    canvas: params.canvas,
  })
}

function copyInternalTransitionsForDuplicatedItems(
  itemIds: string[],
  newItems: TimelineItem[],
): void {
  if (newItems.length === 0) return

  const duplicatedItemByOriginalId = new Map<string, TimelineItem>()
  for (let index = 0; index < itemIds.length; index += 1) {
    const newItem = newItems[index]
    if (newItem) {
      duplicatedItemByOriginalId.set(itemIds[index]!, newItem)
    }
  }

  const copiedTransitions: Transition[] = []
  for (const transition of useTransitionsStore.getState().transitions) {
    const leftClip = duplicatedItemByOriginalId.get(transition.leftClipId)
    const rightClip = duplicatedItemByOriginalId.get(transition.rightClipId)
    if (!leftClip || !rightClip || leftClip.trackId !== rightClip.trackId) {
      continue
    }

    copiedTransitions.push({
      ...transition,
      id: crypto.randomUUID(),
      leftClipId: leftClip.id,
      rightClipId: rightClip.id,
      trackId: leftClip.trackId,
    })
  }

  if (copiedTransitions.length > 0) {
    useTransitionsStore
      .getState()
      .setTransitions([...useTransitionsStore.getState().transitions, ...copiedTransitions])
  }
}

function cloneEasingConfig(config: EasingConfig | undefined): EasingConfig | undefined {
  if (!config) return undefined
  return {
    ...config,
    ...(config.bezier && { bezier: { ...config.bezier } }),
    ...(config.spring && { spring: { ...config.spring } }),
  }
}

function cloneScalarKeyframe(keyframe: Keyframe): Keyframe {
  return {
    ...keyframe,
    id: crypto.randomUUID(),
    easingConfig: cloneEasingConfig(keyframe.easingConfig),
  }
}

function cloneVectorKeyframeForDuplicate(keyframe: VectorKeyframe): VectorKeyframe {
  return {
    ...keyframe,
    id: crypto.randomUUID(),
    value: { ...keyframe.value },
    easingConfig: cloneEasingConfig(keyframe.easingConfig),
    temporalEase: keyframe.temporalEase
      ? {
          ...(keyframe.temporalEase.in && { in: { ...keyframe.temporalEase.in } }),
          ...(keyframe.temporalEase.out && { out: { ...keyframe.temporalEase.out } }),
        }
      : undefined,
    spatial: keyframe.spatial
      ? {
          ...keyframe.spatial,
          inTangent: { ...keyframe.spatial.inTangent },
          outTangent: { ...keyframe.spatial.outTangent },
        }
      : undefined,
  }
}

function clonePropertyKeyframes(property: PropertyKeyframes): PropertyKeyframes {
  return { property: property.property, keyframes: property.keyframes.map(cloneScalarKeyframe) }
}

function cloneVectorPropertyKeyframes(property: VectorPropertyKeyframes): VectorPropertyKeyframes {
  return {
    property: property.property,
    keyframes: property.keyframes.map(cloneVectorKeyframeForDuplicate),
  }
}

function remapDirectPropertyLink(
  link: DirectPropertyLink,
  duplicatedItemIdMap: Map<string, string>,
): DirectPropertyLink {
  return {
    ...link,
    sourceItemId: duplicatedItemIdMap.get(link.sourceItemId) ?? link.sourceItemId,
  }
}

function cloneStoredExpression(
  expression: StoredPropertyExpression,
  duplicatedItemIdMap: Map<string, string>,
): StoredPropertyExpression {
  return expression.type === 'link'
    ? remapDirectPropertyLink(expression, duplicatedItemIdMap)
    : { ...expression }
}

function cloneSeparatedVectorProperties(source: ItemKeyframes, clone: ItemKeyframes): void {
  if (!source.separatedVectorProperties?.length) return
  clone.separatedVectorProperties = [...source.separatedVectorProperties]
}

function cloneItemKeyframes(
  source: ItemKeyframes,
  itemId: string,
  duplicatedItemIdMap: Map<string, string>,
): ItemKeyframes {
  const clone: ItemKeyframes = {
    itemId,
    properties: source.properties.map(clonePropertyKeyframes),
  }
  if (source.animationVersion) clone.animationVersion = source.animationVersion
  if (source.expressions?.length) {
    clone.expressions = source.expressions.map((expression) =>
      cloneStoredExpression(expression, duplicatedItemIdMap),
    )
  }
  if (source.propertyLinks?.length) {
    clone.propertyLinks = source.propertyLinks.map((link) =>
      remapDirectPropertyLink(link, duplicatedItemIdMap),
    )
  }
  if (source.vectorProperties?.length) {
    clone.vectorProperties = source.vectorProperties.map(cloneVectorPropertyKeyframes)
  }
  cloneSeparatedVectorProperties(source, clone)
  return clone
}

function copyKeyframesForDuplicatedItems(itemIds: string[], newItems: TimelineItem[]): void {
  if (newItems.length === 0) return

  const keyframesState = useKeyframesStore.getState()
  const duplicatedItemIdMap = new Map(
    itemIds.flatMap((itemId, index) => {
      const newItem = newItems[index]
      return newItem ? [[itemId, newItem.id] as const] : []
    }),
  )
  const copiedKeyframes = itemIds.flatMap((itemId, index) => {
    const newItem = newItems[index]
    const source = keyframesState.keyframesByItemId[itemId]
    if (!newItem || !source) return []
    return [cloneItemKeyframes(source, newItem.id, duplicatedItemIdMap)]
  })

  if (copiedKeyframes.length > 0) {
    keyframesState.setKeyframes([...keyframesState.keyframes, ...copiedKeyframes])
  }
}

export function addItem(item: TimelineItem): void {
  const [placedItem] = placeItemsWithoutTimelineOverlap([item])
  if (!placedItem) return

  execute(
    'ADD_ITEM',
    () => {
      useItemsStore.getState()._addItem(placedItem)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId: placedItem.id, type: placedItem.type },
  )
}

export function addItems(items: TimelineItem[]): void {
  if (items.length === 0) return
  const placedItems = placeItemsWithoutTimelineOverlap(items)

  execute(
    'ADD_ITEMS',
    () => {
      useItemsStore.getState()._addItems(placedItems)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: placedItems.length },
  )
}

/**
 * Add a video together with a linked audio companion in one undoable step.
 *
 * Used by entry points that place a bare visual item (e.g. the preview canvas
 * drop): when the video carries embedded audio, its audio is split onto a
 * separate audio track so video and audio stay on their own tracks. The video
 * and audio placements are already collision-free (the caller chose the video
 * slot; the audio lands on a free/created audio track), so they're committed
 * directly without re-running overlap placement, which would desync the pair.
 */
export function addItemWithLinkedAudio(video: VideoItem): void {
  const itemsState = useItemsStore.getState()
  const itemsByTrackId = new Map<string, TimelineItem[]>()
  for (const item of itemsState.items) {
    const existing = itemsByTrackId.get(item.trackId)
    if (existing) {
      existing.push(item)
    } else {
      itemsByTrackId.set(item.trackId, [item])
    }
  }

  const { updatedVideo, audioItem, newTrack } = buildLinkedAudioForVideo({
    video,
    tracks: itemsState.tracks,
    itemsByTrackId,
  })

  execute(
    'ADD_ITEM_WITH_LINKED_AUDIO',
    () => {
      const store = useItemsStore.getState()
      if (newTrack) {
        store.setTracks([...store.tracks, newTrack])
      }
      store._addItems([updatedVideo, audioItem])
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId: updatedVideo.id, audioId: audioItem.id, trackCreated: !!newTrack },
  )
}

/**
 * Add a single item together with a freshly created track in one undoable step.
 *
 * Used for overlay layers (text/shape presets dropped on the canvas) that get
 * their own new track above existing content. The caller has already planned
 * the track (so `tracks` includes it) and positioned the item on that empty
 * track, so the placement is collision-free and is committed directly without
 * re-running overlap placement.
 */
export function addItemOnNewTrack(item: TimelineItem, tracks: TimelineTrack[]): void {
  execute(
    'ADD_ITEM_ON_NEW_TRACK',
    () => {
      const store = useItemsStore.getState()
      store.setTracks(tracks)
      store._addItem(item)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId: item.id, type: item.type, trackId: item.trackId },
  )
}

/** Add several layer items and their already-planned backing tracks atomically. */
export function addItemsOnNewTracks(items: TimelineItem[], tracks: TimelineTrack[]): void {
  if (items.length === 0) return
  execute(
    'ADD_ITEMS_ON_NEW_TRACKS',
    () => {
      const store = useItemsStore.getState()
      store.setTracks(tracks)
      store._addItems(items)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: items.length, trackCount: tracks.length },
  )
}

export function updateItem(id: string, updates: Partial<TimelineItem>): void {
  execute(
    'UPDATE_ITEM',
    () => {
      useItemsStore.getState()._updateItem(id, updates)

      // Repair transitions if position changed
      const positionChanged =
        'from' in updates || 'durationInFrames' in updates || 'trackId' in updates
      if (positionChanged) {
        applyTransitionRepairs([id])
      }

      useTimelineSettingsStore.getState().markDirty()
    },
    { id, updates },
  )
}

export function unlinkItems(ids: string[]): void {
  const items = useItemsStore.getState().items
  const unlinkIds = new Set<string>()

  for (const id of ids) {
    for (const linkedId of getLinkedItemIds(items, id)) {
      unlinkIds.add(linkedId)
    }
  }

  const linkedItems = items.filter((item) => unlinkIds.has(item.id) && item.linkedGroupId)
  if (linkedItems.length === 0) return

  // Detect video items that have a linked audio companion — their embedded audio
  // should be muted after unlinking so it doesn't start playing when the audio is deleted.
  const videoIdsWithAudioCompanion = new Set<string>()
  for (const item of linkedItems) {
    if (item.type === 'video') {
      const hasAudio = linkedItems.some(
        (other) => other.type === 'audio' && other.linkedGroupId === item.linkedGroupId,
      )
      if (hasAudio) videoIdsWithAudioCompanion.add(item.id)
    }
  }

  execute(
    'UNLINK_ITEMS',
    () => {
      const store = useItemsStore.getState()
      for (const item of linkedItems) {
        store._updateItem(item.id, {
          linkedGroupId: item.id,
          ...(videoIdsWithAudioCompanion.has(item.id) && { embeddedAudioMuted: true }),
        })
      }
      useSelectionStore.getState().selectItems(linkedItems.map((item) => item.id))
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: linkedItems.map((item) => item.id) },
  )
}

export function linkItems(ids: string[]): boolean {
  const items = useItemsStore.getState().items
  const expandedIds = expandSelectionWithLinkedItems(items, ids)
  const selectedItems = expandedIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is TimelineItem => item !== undefined)

  if (!canLinkSelection(items, ids) || selectedItems.length < 2) {
    return false
  }

  const linkedGroupId = crypto.randomUUID()
  execute(
    'LINK_ITEMS',
    () => {
      const store = useItemsStore.getState()
      for (const item of selectedItems) {
        store._updateItem(item.id, {
          linkedGroupId,
          ...(item.type === 'video' && { embeddedAudioMuted: undefined }),
        })
      }
      useSelectionStore.getState().selectItems(selectedItems.map((item) => item.id))
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: selectedItems.map((item) => item.id) },
  )

  return true
}

export function reverseItems(ids: string[]): void {
  const items = useItemsStore.getState().items
  const timelineFps = useTimelineSettingsStore.getState().fps
  const expandedIds = new Set<string>()
  for (const id of ids) {
    const synchronizedItems = getSynchronizedLinkedItems(items, id)
    if (synchronizedItems.length === 0) {
      expandedIds.add(id)
      continue
    }
    for (const item of synchronizedItems) {
      expandedIds.add(item.id)
    }
  }

  const reversibleItems = Array.from(expandedIds)
    .map((id) => items.find((item) => item.id === id))
    .filter(
      (item): item is TimelineItem =>
        item !== undefined && (item.type === 'video' || item.type === 'audio'),
    )

  if (reversibleItems.length === 0) return
  const shouldReverse = !reversibleItems.every((item) => item.isReversed === true)
  if (shouldReverse) {
    const videoItems = reversibleItems.filter((item) => item.type === 'video')
    if (videoItems.length > 0) {
      useReverseConformDialogStore.getState().open({
        items: reversibleItems,
        videoItems,
        timelineFps,
      })
      return
    }
  }

  execute(
    'REVERSE_ITEMS',
    () => {
      const store = useItemsStore.getState()
      for (const item of reversibleItems) {
        store._updateItem(item.id, {
          isReversed: shouldReverse ? true : undefined,
          ...(!shouldReverse && {
            reverseConformSrc: undefined,
            reverseConformPath: undefined,
            reverseConformKey: undefined,
            reverseConformPreviewSrc: undefined,
            reverseConformPreviewPath: undefined,
            reverseConformPreviewKey: undefined,
            reverseConformPreviewUsesProxy: undefined,
            reverseConformPreviewIsSourceLevel: undefined,
            reverseConformPreviewSourceDuration: undefined,
            reverseConformPreviewFps: undefined,
            reverseConformStatus: undefined,
          }),
        } as Partial<TimelineItem>)
      }
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: reversibleItems.map((item) => item.id), reversed: shouldReverse },
  )
}

export function commitPreparedReverseItems(
  items: TimelineItem[],
  results: ReverseConformResult[],
): void {
  if (items.length === 0) return
  const resultByItemId = new Map(results.map((result) => [result.itemId, result]))

  execute(
    'REVERSE_ITEMS',
    () => {
      const store = useItemsStore.getState()
      for (const item of items) {
        const result = resultByItemId.get(item.id)
        store._updateItem(item.id, {
          isReversed: true,
          ...(item.type === 'video' &&
            result && {
              ...(result.quality === 'full'
                ? {
                    reverseConformSrc: result.src,
                    reverseConformPath: result.path,
                    reverseConformKey: result.key,
                  }
                : {
                    reverseConformPreviewSrc: result.src,
                    reverseConformPreviewPath: result.path,
                    reverseConformPreviewKey: result.key,
                    reverseConformPreviewUsesProxy: result.usesProxy,
                    reverseConformPreviewIsSourceLevel: result.isSourceLevel,
                    reverseConformPreviewSourceDuration: result.sourceDuration,
                    reverseConformPreviewFps: result.conformFps,
                  }),
              reverseConformStatus: 'ready',
            }),
        } as Partial<TimelineItem>)
      }
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: items.map((item) => item.id), reversed: true, conformed: results.length },
  )
}

export function removeItems(ids: string[]): void {
  const expandedIds = expandIdsWithLinkedItems(
    useItemsStore.getState().items,
    ids,
    isLinkedSelectionEnabled(),
  )
  if (expandedIds.length === 0) return

  execute(
    'REMOVE_ITEMS',
    () => {
      // Remove items
      useItemsStore.getState()._removeItems(expandedIds)

      // Cascade: Remove transitions referencing deleted items
      useTransitionsStore.getState()._removeTransitionsForItems(expandedIds)

      // Cascade: Remove keyframes for deleted items
      useKeyframesStore.getState()._removeKeyframesForItems(expandedIds)

      pruneLayerGroupsAfterItemRemoval()

      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: expandedIds },
  )

  emitUiSound('delete')
}

export function rippleDeleteItems(ids: string[]): void {
  const items = useItemsStore.getState().items
  const linkedSelectionEnabled = isLinkedSelectionEnabled()
  const expandedIds = expandIdsWithLinkedItems(items, ids, linkedSelectionEnabled)
  if (expandedIds.length === 0) return

  const idsToDelete = new Set(expandedIds)
  const remainingItems = items.filter((item) => !idsToDelete.has(item.id))
  const baseShiftByItemId = new Map<string, number>()
  const editedTrackIds = new Set(
    items.filter((item) => idsToDelete.has(item.id)).map((item) => item.trackId),
  )
  const removedIntervals = items
    .filter((item) => idsToDelete.has(item.id))
    .map((item) => ({
      start: item.from,
      end: item.from + item.durationInFrames,
    }))

  // Per-track: shift downstream items on the same track as each deleted item.
  // Linked counterparts and attached captions on tracks that won't be handled
  // by sync-lock ripple get shifted manually. Solo clips on unrelated tracks
  // are left in place.
  for (const item of remainingItems) {
    const shiftAmount = items
      .filter((candidate) => idsToDelete.has(candidate.id))
      .filter(
        (deletedItem) =>
          deletedItem.trackId === item.trackId &&
          deletedItem.from + deletedItem.durationInFrames <= item.from,
      )
      .reduce((sum, deletedItem) => sum + deletedItem.durationInFrames, 0)

    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount)
    }
  }

  const trackById = new Map(useItemsStore.getState().tracks.map((track) => [track.id, track]))
  const itemById = new Map(remainingItems.map((item) => [item.id, item]))
  const shiftByItemId = new Map<string, number>()

  for (const [itemId, shiftAmount] of baseShiftByItemId) {
    if (shiftAmount <= 0) continue

    const relatedIds = expandIdsWithLinkedItems(remainingItems, [itemId], linkedSelectionEnabled)
    for (const relatedId of relatedIds) {
      const relatedItem = itemById.get(relatedId)
      if (!relatedItem) continue

      const handledBySyncLock =
        !editedTrackIds.has(relatedItem.trackId) &&
        isTrackSyncLockEnabled(trackById.get(relatedItem.trackId))
      if (handledBySyncLock) {
        continue
      }

      shiftByItemId.set(relatedId, Math.max(shiftByItemId.get(relatedId) ?? 0, shiftAmount))
    }
  }

  const updates = remainingItems.flatMap((item) => {
    const shiftAmount = shiftByItemId.get(item.id) ?? 0
    return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
  })

  // Detect non-shifted items that would be overlapped by shifted items.
  // These get deleted rather than creating overlaps.
  const shiftedById = new Map(updates.map((u) => [u.id, u.from]))
  const coveredIds: string[] = []
  for (const item of remainingItems) {
    if (shiftedById.has(item.id) || idsToDelete.has(item.id)) continue
    const itemEnd = item.from + item.durationInFrames
    // Check if any shifted item on the same track would overlap this item
    for (const other of remainingItems) {
      const newFrom = shiftedById.get(other.id)
      if (newFrom === undefined || other.trackId !== item.trackId) continue
      const newEnd = newFrom + other.durationInFrames
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id)
        break
      }
    }
  }

  // Expand covered IDs with linked companions so we don't orphan them
  const expandedCoveredIds = expandIdsWithLinkedItems(
    remainingItems,
    coveredIds,
    linkedSelectionEnabled,
  )
  const allRemoveIds = [...expandedIds, ...expandedCoveredIds]

  // Filter out updates for items that were removed as covered (including their linked companions)
  const coveredSet = new Set(expandedCoveredIds)
  const filteredUpdates =
    coveredSet.size > 0 ? updates.filter((u) => !coveredSet.has(u.id)) : updates

  execute(
    'RIPPLE_DELETE_ITEMS',
    () => {
      useItemsStore.getState()._removeItems(allRemoveIds)
      if (filteredUpdates.length > 0) {
        useItemsStore.getState()._moveItems(filteredUpdates)
      }

      const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
        editedTrackIds,
        intervals: removedIntervals,
      })

      // Cascade: Remove transitions and keyframes
      const cascadedRemoveIds = Array.from(new Set([...allRemoveIds, ...syncLockResult.removedIds]))
      useTransitionsStore.getState()._removeTransitionsForItems(cascadedRemoveIds)
      useKeyframesStore.getState()._removeKeyframesForItems(cascadedRemoveIds)

      // Repair transitions on moved clips (they may now overlap or gap differently)
      if (filteredUpdates.length > 0) {
        applyTransitionRepairs(filteredUpdates.map((u) => u.id))
      }

      // Repair transitions for surviving clips that were shifted
      const repairedClipIds = Array.from(
        new Set([...updates.map((update) => update.id), ...syncLockResult.affectedIds]),
      )
      if (repairedClipIds.length > 0) {
        applyTransitionRepairs(repairedClipIds, new Set(cascadedRemoveIds))
      }

      pruneLayerGroupsAfterItemRemoval()

      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: allRemoveIds },
  )
}

export function closeGapAtPosition(trackId: string, frame: number): void {
  const items = useItemsStore.getState().items
  const targetFrame = Math.max(0, Math.round(frame))
  const trackItems = items
    .filter((item) => item.trackId === trackId)
    .sort((left, right) => left.from - right.from)

  if (trackItems.length === 0) return

  let gapStart = 0
  let gapEnd = 0

  for (const item of trackItems) {
    if (targetFrame >= gapStart && targetFrame < item.from) {
      gapEnd = item.from
      break
    }
    gapStart = item.from + item.durationInFrames
  }

  if (gapEnd <= gapStart) return

  const gapSize = gapEnd - gapStart
  const updates = items
    .filter((item) => item.trackId === trackId && item.from >= gapEnd)
    .map((item) => ({ id: item.id, from: item.from - gapSize }))
  if (updates.length === 0) return

  execute(
    'CLOSE_GAP',
    () => {
      useItemsStore.getState()._moveItems(updates)
      const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
        editedTrackIds: new Set([trackId]),
        intervals: [{ start: gapStart, end: gapEnd }],
      })

      const removedIds = syncLockResult.removedIds
      if (removedIds.length > 0) {
        useTransitionsStore.getState()._removeTransitionsForItems(removedIds)
        useKeyframesStore.getState()._removeKeyframesForItems(removedIds)
      }

      applyTransitionRepairs(
        Array.from(new Set([...updates.map((update) => update.id), ...syncLockResult.affectedIds])),
        removedIds.length > 0 ? new Set(removedIds) : undefined,
      )

      useTimelineSettingsStore.getState().markDirty()
    },
    { trackId, frame },
  )
}

export function closeAllGapsOnTrack(trackId: string): void {
  const items = useItemsStore.getState().items
  const trackItems = items
    .filter((item) => item.trackId === trackId)
    .sort((left, right) => left.from - right.from)

  if (trackItems.length === 0) return

  let cursor = 0
  const baseShiftByItemId = new Map<string, number>()
  for (const item of trackItems) {
    const newFrom = item.from > cursor ? cursor : item.from
    const shiftAmount = item.from - newFrom
    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount)
    }
    cursor = newFrom + item.durationInFrames
  }

  const updates = buildLinkedLeftShiftUpdates(items, baseShiftByItemId, isLinkedSelectionEnabled())
  if (updates.length === 0) return

  execute(
    'CLOSE_ALL_GAPS',
    () => {
      useItemsStore.getState()._moveItems(updates)
      applyTransitionRepairs(updates.map((update) => update.id))
      useTimelineSettingsStore.getState().markDirty()
    },
    { trackId },
  )
}

/**
 * Track push: move ALL items at or after the anchor clip's position — across
 * every track — by the given frame delta.  This is a multi-track ripple
 * move that closes or opens a gap at the anchor point.
 * Commits as a single undo entry.
 */
export function trackPushItems(anchorId: string, delta: number): void {
  if (delta === 0) return

  const items = useItemsStore.getState().items
  const anchor = items.find((i) => i.id === anchorId)
  if (!anchor) return

  const cutFrame = anchor.from

  // Every item whose start is at or after the cut frame gets shifted
  const updates: Array<{ id: string; from: number }> = []
  for (const ti of items) {
    if (ti.from >= cutFrame) {
      updates.push({ id: ti.id, from: Math.max(0, ti.from + delta) })
    }
  }

  if (updates.length === 0) return

  execute(
    'TRACK_PUSH',
    () => {
      useItemsStore.getState()._moveItems(updates)
      applyTransitionRepairs(updates.map((u) => u.id))
      useTimelineSettingsStore.getState().markDirty()
    },
    { anchorId, delta },
  )
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute(
    'MOVE_ITEM',
    () => {
      useItemsStore.getState()._moveItem(id, newFrom, newTrackId)

      // Repair transitions
      applyTransitionRepairs([id])

      useTimelineSettingsStore.getState().markDirty()
      warnIfOverlapping('MOVE_ITEM')
    },
    { id, newFrom, newTrackId },
  )
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
  execute(
    'MOVE_ITEMS',
    () => {
      useItemsStore.getState()._moveItems(updates)

      const movedItemIds = new Set(updates.map((u) => u.id))
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions

      // Update transition trackIds when both clips of a pair move together
      const updatedTransitions = transitions.map((t) => {
        const leftMoved = movedItemIds.has(t.leftClipId)
        const rightMoved = movedItemIds.has(t.rightClipId)

        if (leftMoved && rightMoved) {
          const leftClip = items.find((i) => i.id === t.leftClipId)
          const rightClip = items.find((i) => i.id === t.rightClipId)

          // If they're now on the same track, update transition trackId
          if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
            return { ...t, trackId: leftClip.trackId }
          }
        }
        return t
      })

      // Apply updated transitions (with trackId fixes) then repair
      useTransitionsStore.getState().setTransitions(updatedTransitions)
      applyTransitionRepairs(updates.map((u) => u.id))

      useTimelineSettingsStore.getState().markDirty()
      warnIfOverlapping('MOVE_ITEMS')
    },
    { count: updates.length },
  )
}

export function moveItemsWithTrackChanges(
  tracks: TimelineTrack[],
  updates: Array<{ id: string; from: number; trackId?: string }>,
): void {
  execute(
    'MOVE_ITEMS_WITH_TRACKS',
    () => {
      useItemsStore.getState().setTracks(tracks)
      useItemsStore.getState()._moveItems(updates)

      const movedItemIds = new Set(updates.map((u) => u.id))
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions

      const updatedTransitions = transitions.map((t) => {
        const leftMoved = movedItemIds.has(t.leftClipId)
        const rightMoved = movedItemIds.has(t.rightClipId)

        if (leftMoved && rightMoved) {
          const leftClip = items.find((i) => i.id === t.leftClipId)
          const rightClip = items.find((i) => i.id === t.rightClipId)

          if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
            return { ...t, trackId: leftClip.trackId }
          }
        }
        return t
      })

      useTransitionsStore.getState().setTransitions(updatedTransitions)
      applyTransitionRepairs(updates.map((u) => u.id))
      useTimelineSettingsStore.getState().markDirty()
      warnIfOverlapping('MOVE_ITEMS_WITH_TRACKS')
    },
    { count: updates.length, trackCount: tracks.length },
  )
}

export function duplicateItems(
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>,
): TimelineItem[] {
  const result = execute(
    'DUPLICATE_ITEMS',
    () => {
      const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions)
      copyInternalTransitionsForDuplicatedItems(itemIds, newItems)
      copyKeyframesForDuplicatedItems(itemIds, newItems)
      useTimelineSettingsStore.getState().markDirty()
      return newItems
    },
    { itemIds, count: positions.length },
  )
  emitUiSound('confirm')
  return result
}

export function duplicateItemsWithTrackChanges(
  tracks: TimelineTrack[],
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>,
): TimelineItem[] {
  return execute(
    'DUPLICATE_ITEMS_WITH_TRACKS',
    () => {
      useItemsStore.getState().setTracks(tracks)
      const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions)
      copyInternalTransitionsForDuplicatedItems(itemIds, newItems)
      copyKeyframesForDuplicatedItems(itemIds, newItems)
      useTimelineSettingsStore.getState().markDirty()
      return newItems
    },
    { itemIds, count: positions.length, trackCount: tracks.length },
  )
}

export * from './item-edit-actions'
