import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import {
  Captions,
  Crosshair,
  Image as ImageIcon,
  Layers,
  Music,
  Square,
  Sticker,
  Type,
  Video,
} from 'lucide-react'
import type { AnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  getAnimatablePropertiesForItem,
  getProceduralBands,
} from '@/features/editor/deps/timeline-motion'
import {
  getTextMotionTimelineBands,
  type TextMotionTimelineBand,
} from '@/shared/timeline/text-motion-timeline'
import { getVisibleMotionPathProperties } from './motion-path-property-visibility'
import type { InlineCurveState } from './motion-timeline-primitives'
import type { RowReorderDragState } from './motion-row-reorder'

export interface LayerEntry {
  item: TimelineItem
  track: TimelineTrack | undefined
}

export type MotionRow =
  | { kind: 'group'; track: TimelineTrack; items: TimelineItem[] }
  | { kind: 'layer'; item: TimelineItem; track: TimelineTrack | undefined; depth: number }

export interface LayerParentCandidate extends LayerEntry {
  layerNumber: number
}

/** Every layer a row can parent to: anything but itself and the non-rendering types. */
function getLayerParentCandidates(
  layerEntries: readonly LayerEntry[],
  itemId: string,
): LayerParentCandidate[] {
  const candidates: LayerParentCandidate[] = []
  layerEntries.forEach((entry, layerIndex) => {
    const candidate = entry.item
    if (candidate.id === itemId) return
    if (candidate.type === 'audio' || candidate.type === 'adjustment') return
    candidates.push({ ...entry, layerNumber: layerIndex + 1 })
  })
  return candidates
}

interface LayerPropertyVisibilityInput {
  properties: readonly AnimatableProperty[]
  propertyFilter: 'all' | 'keyframed'
  textMotionBands: readonly TextMotionTimelineBand[]
  proceduralBands: ReadonlyMap<AnimatableProperty, unknown>
  itemKeyframes: ItemKeyframes | undefined
}

function isKeyedOrProceduralProperty(
  property: AnimatableProperty,
  input: LayerPropertyVisibilityInput,
): boolean {
  if (input.proceduralBands.has(property)) return true
  const keyed = input.itemKeyframes?.properties.some(
    (entry) => entry.property === property && entry.keyframes.length > 0,
  )
  return keyed === true
}

/**
 * Whether the row has anything to expand into: either every property is shown,
 * or at least one visible property carries keyframes or procedural motion.
 */
function hasVisibleLayerChildProperties(input: LayerPropertyVisibilityInput): boolean {
  if (input.propertyFilter === 'all') return true
  if (input.textMotionBands.length > 0) return true
  return input.properties.some((property) => isKeyedOrProceduralProperty(property, input))
}

const LAYER_TYPE_ICONS: Record<TimelineItem['type'], LucideIcon> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
  lottie: Sticker,
  text: Type,
  shape: Square,
  adjustment: Layers,
  controller: Crosshair,
  composition: Layers,
  subtitle: Captions,
}

export interface MotionLayerRowModelInput {
  item: TimelineItem
  track: TimelineTrack | undefined
  layerEntries: readonly LayerEntry[]
  itemKeyframes: ItemKeyframes | undefined
  trackById: ReadonlyMap<string, TimelineTrack>
  expandedLayerIdSet: ReadonlySet<string>
  selectedItemIdSet: ReadonlySet<string>
  allPathVertexItemIds: ReadonlySet<string>
  maskEditingItemId: string | null
  selectedPathVertexIndices: readonly number[]
  activeInlineCurve: InlineCurveState | null
  propertyFilter: 'all' | 'keyframed'
  rowReorderDrag: RowReorderDragState | null
  t: TFunction
}

export interface MotionLayerRowModel {
  parentItemId: string | undefined
  parentCandidates: LayerParentCandidate[]
  expanded: boolean
  selected: boolean
  isParentLayerGroupLocked: boolean
  isLayerLocked: boolean
  LayerTypeIcon: LucideIcon
  isPathShape: boolean
  showAllPathVertices: boolean
  properties: AnimatableProperty[]
  textMotionBands: TextMotionTimelineBand[]
  hasProceduralMotion: boolean
  hasVisibleChildProperties: boolean
  isDragging: boolean
  nullObjectNonRenderingLabel: string | undefined
}

function getNullObjectNonRenderingLabel(item: TimelineItem, t: TFunction): string | undefined {
  if (item.type !== 'controller') return undefined
  return t('editor.compose.nullObjectNonRendering', {
    defaultValue: 'Null Object (does not render)',
  })
}

function resolveParentLayerGroup(
  track: TimelineTrack | undefined,
  trackById: ReadonlyMap<string, TimelineTrack>,
): TimelineTrack | undefined {
  const parentTrackId = track?.parentTrackId
  return parentTrackId ? trackById.get(parentTrackId) : undefined
}

function getRowVisibleProperties(
  input: MotionLayerRowModelInput,
  showAllPathVertices: boolean,
): AnimatableProperty[] {
  const activeInlineCurve = input.activeInlineCurve
  const alwaysInclude =
    activeInlineCurve?.itemId === input.item.id ? activeInlineCurve.property : null
  return getVisibleMotionPathProperties(getAnimatablePropertiesForItem(input.item), {
    itemKeyframes: input.itemKeyframes,
    selectedVertexIndices:
      input.maskEditingItemId === input.item.id ? input.selectedPathVertexIndices : [],
    showAllVertices: showAllPathVertices,
    alwaysInclude,
  })
}

export interface MotionGroupRowModel {
  /** Every layer inside the group is selected, so the header reads as selected. */
  groupSelected: boolean
  /** First frame the group covers, for the span it draws. */
  groupFrom: number
  /** Frame the group's longest layer ends on. */
  groupEnd: number
  groupItemIds: string[]
  /** Tracks parented to the group, taken with it when the group is deleted. */
  groupTrackIds: string[]
  /** The group's own row is the one being reordered. */
  isDragging: boolean
}

/**
 * What a layer-group row derives from its items and the tracks below it.
 *
 * A group with no layers left has no span to draw, so its range collapses to
 * zero instead of inheriting a neighbour's extent.
 */
export function buildMotionGroupRowModel(input: {
  row: Extract<MotionRow, { kind: 'group' }>
  tracks: readonly TimelineTrack[]
  selectedItemIdSet: ReadonlySet<string>
  rowReorderDrag: RowReorderDragState | null
}): MotionGroupRowModel {
  const { row, tracks, selectedItemIdSet, rowReorderDrag } = input
  const hasItems = row.items.length > 0
  return {
    groupSelected: hasItems && row.items.every((item) => selectedItemIdSet.has(item.id)),
    groupFrom: hasItems ? Math.min(...row.items.map((item) => item.from)) : 0,
    groupEnd: hasItems
      ? Math.max(...row.items.map((item) => item.from + item.durationInFrames))
      : 0,
    groupItemIds: row.items.map((item) => item.id),
    groupTrackIds: tracks
      .filter((track) => track.parentTrackId === row.track.id)
      .map((track) => track.id),
    isDragging: rowReorderDrag?.sourceTrackId === row.track.id,
  }
}

export function buildMotionLayerRowModel(input: MotionLayerRowModelInput): MotionLayerRowModel {
  const { item, track } = input
  const parentLayerGroup = resolveParentLayerGroup(track, input.trackById)
  const isParentLayerGroupLocked = parentLayerGroup?.locked === true
  const showAllPathVertices = input.allPathVertexItemIds.has(item.id)
  const properties = getRowVisibleProperties(input, showAllPathVertices)
  const proceduralBands = getProceduralBands(item.motionModifiers, item.durationInFrames, item.from)
  const textMotionBands = getTextMotionTimelineBands(item)

  return {
    parentItemId: item.transformParent?.parentItemId,
    parentCandidates: getLayerParentCandidates(input.layerEntries, item.id),
    expanded: input.expandedLayerIdSet.has(item.id),
    selected: input.selectedItemIdSet.has(item.id),
    isParentLayerGroupLocked,
    isLayerLocked: track?.locked === true || isParentLayerGroupLocked,
    LayerTypeIcon: LAYER_TYPE_ICONS[item.type],
    isPathShape: item.type === 'shape' && item.shapeType === 'path',
    showAllPathVertices,
    properties,
    textMotionBands,
    hasProceduralMotion: proceduralBands.size > 0 || textMotionBands.length > 0,
    hasVisibleChildProperties: hasVisibleLayerChildProperties({
      properties,
      propertyFilter: input.propertyFilter,
      textMotionBands,
      proceduralBands,
      itemKeyframes: input.itemKeyframes,
    }),
    isDragging: input.rowReorderDrag?.sourceTrackId === track?.id,
    nullObjectNonRenderingLabel: getNullObjectNonRenderingLabel(item, input.t),
  }
}
