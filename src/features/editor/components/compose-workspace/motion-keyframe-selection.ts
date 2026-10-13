import type {
  AnimatableProperty,
  ItemKeyframes,
  KeyframeRef,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { getMotionVectorProxy, getStoredMotionVectorKeyframeId } from './motion-vector-rows'

export type MotionSelectionStorage =
  | {
      kind: 'scalar'
      property: AnimatableProperty
      keyframeId: string
    }
  | {
      kind: 'vector'
      property: VectorAnimatableProperty
      keyframeId: string
    }

export interface MotionSelectionDragEntry {
  ref: KeyframeRef
  storage: MotionSelectionStorage
  initialFrame: number
  availableFrames: readonly number[]
}

export interface MotionSelectionDragState {
  entries: MotionSelectionDragEntry[]
  spansMultipleItems: boolean
  minDeltaFrames: number
  maxDeltaFrames: number
}

export interface MotionSelectionFrameUpdates {
  scalar: Array<{
    itemId: string
    property: AnimatableProperty
    keyframeId: string
    frame: number
  }>
  vector: Array<{
    itemId: string
    property: VectorAnimatableProperty
    keyframeId: string
    frame: number
  }>
}

export interface MotionSelectionTimeRange {
  startFrame: number
  endFrame: number
  keyframeCount: number
  itemCount: number
}

function getVectorStorage(ref: KeyframeRef): MotionSelectionStorage | null {
  const proxy = getMotionVectorProxy(ref.property)
  return proxy
    ? {
        kind: 'vector',
        property: proxy.property,
        keyframeId: getStoredMotionVectorKeyframeId(ref.keyframeId, proxy.axis),
      }
    : null
}

function getStorageKey(itemId: string, storage: MotionSelectionStorage): string {
  return `${itemId}:${storage.kind}:${storage.property}:${storage.keyframeId}`
}

function getStorageGroupKey(itemId: string, storage: MotionSelectionStorage): string {
  return `${itemId}:${storage.kind}:${storage.property}`
}

function resolveStorage(
  itemKeyframes: ItemKeyframes,
  ref: KeyframeRef,
): { storage: MotionSelectionStorage; frame: number } | null {
  const scalarKeyframe = itemKeyframes.properties
    .find((property) => property.property === ref.property)
    ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
  if (scalarKeyframe) {
    return {
      storage: { kind: 'scalar', property: ref.property, keyframeId: ref.keyframeId },
      frame: scalarKeyframe.frame,
    }
  }

  const vectorStorage = getVectorStorage(ref)
  if (!vectorStorage || vectorStorage.kind !== 'vector') return null
  const vectorKeyframe = itemKeyframes.vectorProperties
    ?.find((property) => property.property === vectorStorage.property)
    ?.keyframes.find((keyframe) => keyframe.id === vectorStorage.keyframeId)
  return vectorKeyframe ? { storage: vectorStorage, frame: vectorKeyframe.frame } : null
}

function getStorageKeyframes(itemKeyframes: ItemKeyframes, storage: MotionSelectionStorage) {
  return storage.kind === 'scalar'
    ? (itemKeyframes.properties.find((property) => property.property === storage.property)
        ?.keyframes ?? [])
    : (itemKeyframes.vectorProperties?.find((property) => property.property === storage.property)
        ?.keyframes ?? [])
}

export function mergeMotionKeyframeSelection(
  currentSelection: readonly KeyframeRef[],
  itemId: string,
  nextItemSelection: readonly KeyframeRef[],
  preserveExternalSelection: boolean,
): KeyframeRef[] {
  if (!preserveExternalSelection) return [...nextItemSelection]
  return [
    ...currentSelection.filter((reference) => reference.itemId !== itemId),
    ...nextItemSelection,
  ]
}

function collectMotionSelectionEntries(
  selection: readonly KeyframeRef[],
  keyframesByItemId: Readonly<Record<string, ItemKeyframes>>,
  itemById: Readonly<Record<string, TimelineItem>>,
): MotionSelectionDragEntry[] {
  const entries: MotionSelectionDragEntry[] = []
  const seenStorageKeys = new Set<string>()
  for (const ref of selection) {
    const itemKeyframes = keyframesByItemId[ref.itemId]
    if (!itemKeyframes || !itemById[ref.itemId]) continue
    const resolved = resolveStorage(itemKeyframes, ref)
    if (!resolved) continue
    const storageKey = getStorageKey(ref.itemId, resolved.storage)
    if (seenStorageKeys.has(storageKey)) continue
    seenStorageKeys.add(storageKey)
    entries.push({
      ref,
      storage: resolved.storage,
      initialFrame: resolved.frame,
      availableFrames: [],
    })
  }
  return entries
}

function groupSelectedStorageIds(
  entries: readonly MotionSelectionDragEntry[],
): Map<string, Set<string>> {
  const selectedIdsByGroup = new Map<string, Set<string>>()
  for (const entry of entries) {
    const groupKey = getStorageGroupKey(entry.ref.itemId, entry.storage)
    const selectedIds = selectedIdsByGroup.get(groupKey) ?? new Set<string>()
    selectedIds.add(entry.storage.keyframeId)
    selectedIdsByGroup.set(groupKey, selectedIds)
  }
  return selectedIdsByGroup
}

function findPreviousUnselectedFrame(
  keyframes: ReturnType<typeof getStorageKeyframes>,
  entryIndex: number,
  selectedIds: ReadonlySet<string>,
): number | null {
  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const keyframe = keyframes[index]
    if (keyframe && !selectedIds.has(keyframe.id)) return keyframe.frame
  }
  return null
}

function findNextUnselectedFrame(
  keyframes: ReturnType<typeof getStorageKeyframes>,
  entryIndex: number,
  selectedIds: ReadonlySet<string>,
): number | null {
  for (let index = entryIndex + 1; index < keyframes.length; index += 1) {
    const keyframe = keyframes[index]
    if (keyframe && !selectedIds.has(keyframe.id)) return keyframe.frame
  }
  return null
}

function addEntryConstraints(
  entry: MotionSelectionDragEntry,
  item: TimelineItem,
  itemKeyframes: ItemKeyframes,
  selectedIds: ReadonlySet<string>,
): { minDeltaFrames: number; maxDeltaFrames: number } {
  const propertyKeyframes = getStorageKeyframes(itemKeyframes, entry.storage).toSorted(
    (left, right) => left.frame - right.frame,
  )
  const entryIndex = propertyKeyframes.findIndex(
    (keyframe) => keyframe.id === entry.storage.keyframeId,
  )
  const occupiedFrames = new Set(
    propertyKeyframes
      .filter((keyframe) => !selectedIds.has(keyframe.id))
      .map((keyframe) => keyframe.frame),
  )
  entry.availableFrames = Array.from(
    { length: Math.max(1, item.durationInFrames) },
    (_, frame) => frame,
  ).filter((frame) => !occupiedFrames.has(frame))

  const previousFrame = findPreviousUnselectedFrame(propertyKeyframes, entryIndex, selectedIds)
  const nextFrame = findNextUnselectedFrame(propertyKeyframes, entryIndex, selectedIds)
  return {
    minDeltaFrames:
      previousFrame === null
        ? -entry.initialFrame
        : Math.max(-entry.initialFrame, previousFrame + 1 - entry.initialFrame),
    maxDeltaFrames:
      nextFrame === null
        ? Math.max(0, item.durationInFrames - 1) - entry.initialFrame
        : Math.min(
            Math.max(0, item.durationInFrames - 1) - entry.initialFrame,
            nextFrame - 1 - entry.initialFrame,
          ),
  }
}

export function buildMotionSelectionDragState(
  selection: readonly KeyframeRef[],
  keyframesByItemId: Readonly<Record<string, ItemKeyframes>>,
  itemById: Readonly<Record<string, TimelineItem>>,
): MotionSelectionDragState | null {
  const entries = collectMotionSelectionEntries(selection, keyframesByItemId, itemById)
  if (entries.length === 0) return null
  const selectedStorageIdsByGroup = groupSelectedStorageIds(entries)
  let minDeltaFrames = -Infinity
  let maxDeltaFrames = Infinity
  for (const entry of entries) {
    const item = itemById[entry.ref.itemId]!
    const itemKeyframes = keyframesByItemId[entry.ref.itemId]!
    const groupKey = getStorageGroupKey(entry.ref.itemId, entry.storage)
    const selectedIds = selectedStorageIdsByGroup.get(groupKey) ?? new Set<string>()
    const constraints = addEntryConstraints(entry, item, itemKeyframes, selectedIds)
    minDeltaFrames = Math.max(minDeltaFrames, constraints.minDeltaFrames)
    maxDeltaFrames = Math.min(maxDeltaFrames, constraints.maxDeltaFrames)
  }

  return {
    entries,
    spansMultipleItems: new Set(entries.map((entry) => entry.ref.itemId)).size > 1,
    minDeltaFrames,
    maxDeltaFrames,
  }
}

function findClosestFrameIndex(
  frames: readonly number[],
  targetFrame: number,
  minIndex: number,
  maxIndex: number,
): number {
  let low = minIndex
  let high = maxIndex
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((frames[middle] ?? targetFrame) < targetFrame) low = middle + 1
    else high = middle
  }
  const upperIndex = Math.max(minIndex, Math.min(maxIndex, low))
  const lowerIndex = Math.max(minIndex, upperIndex - 1)
  const upperDistance = Math.abs((frames[upperIndex] ?? targetFrame) - targetFrame)
  const lowerDistance = Math.abs((frames[lowerIndex] ?? targetFrame) - targetFrame)
  return lowerDistance <= upperDistance ? lowerIndex : upperIndex
}

export function getMotionSelectionTimeRange(
  state: MotionSelectionDragState,
  itemById: Readonly<Record<string, TimelineItem>>,
): MotionSelectionTimeRange | null {
  const absoluteFrames = state.entries.flatMap((entry) => {
    const item = itemById[entry.ref.itemId]
    return item ? [item.from + entry.initialFrame] : []
  })
  if (absoluteFrames.length === 0) return null
  return {
    startFrame: Math.min(...absoluteFrames),
    endFrame: Math.max(...absoluteFrames),
    keyframeCount: state.entries.length,
    itemCount: new Set(state.entries.map((entry) => entry.ref.itemId)).size,
  }
}

function getMotionRetimeScale(
  range: MotionSelectionTimeRange,
  edge: 'start' | 'end',
  requestedEdgeFrame: number,
  compositionDurationInFrames: number,
): { pivotFrame: number; scale: number } {
  const maxCompositionFrame = Math.max(0, compositionDurationInFrames - 1)
  const nextEdgeFrame =
    edge === 'start'
      ? Math.max(0, Math.min(range.endFrame - 1, Math.round(requestedEdgeFrame)))
      : Math.max(
          range.startFrame + 1,
          Math.min(maxCompositionFrame, Math.round(requestedEdgeFrame)),
        )
  const pivotFrame = edge === 'start' ? range.endFrame : range.startFrame
  const initialEdgeFrame = edge === 'start' ? range.startFrame : range.endFrame
  return {
    pivotFrame,
    scale: (nextEdgeFrame - pivotFrame) / (initialEdgeFrame - pivotFrame),
  }
}

function groupMotionSelectionEntries(
  entries: readonly MotionSelectionDragEntry[],
): Map<string, MotionSelectionDragEntry[]> {
  const entriesByGroup = new Map<string, MotionSelectionDragEntry[]>()
  for (const entry of entries) {
    const groupKey = getStorageGroupKey(entry.ref.itemId, entry.storage)
    const groupEntries = entriesByGroup.get(groupKey) ?? []
    groupEntries.push(entry)
    entriesByGroup.set(groupKey, groupEntries)
  }
  return entriesByGroup
}

function buildRetimedFrameMap(
  entriesByGroup: ReadonlyMap<string, MotionSelectionDragEntry[]>,
  itemById: Readonly<Record<string, TimelineItem>>,
  pivotFrame: number,
  scale: number,
): Map<string, number> {
  const nextFrameByStorageKey = new Map<string, number>()
  for (const entries of entriesByGroup.values()) {
    const sortedEntries = entries.toSorted((left, right) => left.initialFrame - right.initialFrame)
    const availableFrames = sortedEntries[0]?.availableFrames ?? []
    let previousAvailableIndex = -1
    for (let index = 0; index < sortedEntries.length; index += 1) {
      const entry = sortedEntries[index]!
      const item = itemById[entry.ref.itemId]!
      const initialAbsoluteFrame = item.from + entry.initialFrame
      const targetLocalFrame =
        pivotFrame + Math.round((initialAbsoluteFrame - pivotFrame) * scale) - item.from
      const availableIndex = findClosestFrameIndex(
        availableFrames,
        targetLocalFrame,
        previousAvailableIndex + 1,
        availableFrames.length - (sortedEntries.length - index),
      )
      previousAvailableIndex = availableIndex
      nextFrameByStorageKey.set(
        getStorageKey(entry.ref.itemId, entry.storage),
        availableFrames[availableIndex] ?? entry.initialFrame,
      )
    }
  }
  return nextFrameByStorageKey
}

function appendMotionFrameUpdate(
  updates: MotionSelectionFrameUpdates,
  entry: MotionSelectionDragEntry,
  frame: number,
): void {
  if (entry.storage.kind === 'scalar') {
    updates.scalar.push({
      itemId: entry.ref.itemId,
      property: entry.storage.property,
      keyframeId: entry.storage.keyframeId,
      frame,
    })
    return
  }
  updates.vector.push({
    itemId: entry.ref.itemId,
    property: entry.storage.property,
    keyframeId: entry.storage.keyframeId,
    frame,
  })
}

export function buildMotionSelectionRetimeUpdates(
  state: MotionSelectionDragState,
  itemById: Readonly<Record<string, TimelineItem>>,
  edge: 'start' | 'end',
  requestedEdgeFrame: number,
  compositionDurationInFrames: number,
): MotionSelectionFrameUpdates {
  const range = getMotionSelectionTimeRange(state, itemById)
  if (!range || range.startFrame === range.endFrame) {
    return buildMotionSelectionFrameUpdates(state, 0)
  }
  const retime = getMotionRetimeScale(range, edge, requestedEdgeFrame, compositionDurationInFrames)
  const entriesByGroup = groupMotionSelectionEntries(state.entries)
  const nextFrameByStorageKey = buildRetimedFrameMap(
    entriesByGroup,
    itemById,
    retime.pivotFrame,
    retime.scale,
  )
  const updates: MotionSelectionFrameUpdates = { scalar: [], vector: [] }
  for (const entry of state.entries) {
    const frame =
      nextFrameByStorageKey.get(getStorageKey(entry.ref.itemId, entry.storage)) ??
      entry.initialFrame
    appendMotionFrameUpdate(updates, entry, frame)
  }
  return updates
}

export function constrainMotionSelectionDelta(
  state: MotionSelectionDragState,
  requestedDeltaFrames: number,
): number {
  return Math.max(
    state.minDeltaFrames,
    Math.min(state.maxDeltaFrames, Math.round(requestedDeltaFrames)),
  )
}

export function buildMotionSelectionFrameUpdates(
  state: MotionSelectionDragState,
  requestedDeltaFrames: number,
): MotionSelectionFrameUpdates {
  const deltaFrames = constrainMotionSelectionDelta(state, requestedDeltaFrames)
  const updates: MotionSelectionFrameUpdates = { scalar: [], vector: [] }
  for (const entry of state.entries) {
    appendMotionFrameUpdate(updates, entry, entry.initialFrame + deltaFrames)
  }
  return updates
}

function getSelectedStorageKeys(
  keyframesByItemId: Readonly<Record<string, ItemKeyframes>>,
  selectedKeyframes: readonly KeyframeRef[],
): Set<string> {
  const selectedStorageKeys = new Set<string>()
  for (const ref of selectedKeyframes) {
    const itemKeyframes = keyframesByItemId[ref.itemId]
    if (!itemKeyframes) continue
    const resolved = resolveStorage(itemKeyframes, ref)
    if (resolved) selectedStorageKeys.add(getStorageKey(ref.itemId, resolved.storage))
  }
  return selectedStorageKeys
}

function addScalarSnapFrames(
  frames: Set<number>,
  selectedStorageKeys: ReadonlySet<string>,
  itemId: string,
  item: TimelineItem,
  itemKeyframes: ItemKeyframes,
): void {
  for (const property of itemKeyframes.properties) {
    for (const keyframe of property.keyframes) {
      const storage: MotionSelectionStorage = {
        kind: 'scalar',
        property: property.property,
        keyframeId: keyframe.id,
      }
      if (!selectedStorageKeys.has(getStorageKey(itemId, storage))) {
        frames.add(item.from + keyframe.frame)
      }
    }
  }
}

function addVectorSnapFrames(
  frames: Set<number>,
  selectedStorageKeys: ReadonlySet<string>,
  itemId: string,
  item: TimelineItem,
  itemKeyframes: ItemKeyframes,
): void {
  for (const property of itemKeyframes.vectorProperties ?? []) {
    for (const keyframe of property.keyframes) {
      const storage: MotionSelectionStorage = {
        kind: 'vector',
        property: property.property,
        keyframeId: keyframe.id,
      }
      if (!selectedStorageKeys.has(getStorageKey(itemId, storage))) {
        frames.add(item.from + keyframe.frame)
      }
    }
  }
}

export function getMotionCompositionSnapFrames(
  keyframesByItemId: Readonly<Record<string, ItemKeyframes>>,
  itemById: Readonly<Record<string, TimelineItem>>,
  selectedKeyframes: readonly KeyframeRef[],
): number[] {
  const selectedStorageKeys = getSelectedStorageKeys(keyframesByItemId, selectedKeyframes)
  const frames = new Set<number>()
  for (const [itemId, itemKeyframes] of Object.entries(keyframesByItemId)) {
    const item = itemById[itemId]
    if (!item) continue
    frames.add(item.from)
    frames.add(item.from + Math.max(0, item.durationInFrames - 1))
    addScalarSnapFrames(frames, selectedStorageKeys, itemId, item, itemKeyframes)
    addVectorSnapFrames(frames, selectedStorageKeys, itemId, item, itemKeyframes)
  }
  return [...frames]
}
