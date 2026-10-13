import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  ChevronDown,
  ChevronRight,
  Captions,
  ClipboardPaste,
  Blend,
  Copy,
  Crop,
  CopyPlus,
  Crosshair,
  EllipsisVertical,
  Eye,
  EyeOff,
  Group,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize2,
  Music,
  Plus,
  Pencil,
  Spline,
  Square,
  Sticker,
  Type,
  Trash2,
  Ungroup,
  Unlock,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { useRafDeferredValue } from '@/shared/hooks/use-raf-deferred-value'
import { hasEnabledProceduralMotion } from '@/shared/timeline/procedural-motion'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useEditorStore } from '@/shared/state/editor'
import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  KeyframeRef,
  DirectLinkableProperty,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import {
  getDirectPropertyLinks,
  isShapeAnimatableProperty,
  isTransformAnimatableProperty,
} from '@/types/keyframe'
import type { BlendMode } from '@/types/blend-modes'
import { BLEND_MODE_GROUPS, BLEND_MODE_LABELS } from '@/types/blend-modes'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TextMotionSlot } from '@/types/text-motion'
import {
  getTextMotionTimelineBands,
  type TextMotionTimelineBand,
} from '@/shared/timeline/text-motion-timeline'
import {
  addItemOnNewTrack,
  addItemsOnNewTracks,
  addKeyframe,
  buildVectorPromotionPlan,
  buildDroppedCompositionTimelineItems,
  buildDroppedMediaTimelineItems,
  captureSnapshot,
  CompactNavigator,
  getKeyframeNavigatorThumbMetrics,
  getNiceTickStep,
  createTimelineTemplateItem,
  createDefaultControllerItem,
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createTextTemplateItem,
  DopesheetEditor,
  PickWhipIcon,
  PropertyLinkPickWhipOverlay,
  duplicateItemsWithTrackChanges,
  getAnimatablePropertiesForItem,
  getProceduralBands,
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
  getShapeAnimatableBaseValue,
  getDroppedMediaDurationInFrames,
  isTimelineTemplateDragData,
  interpolatePropertyValue,
  resolveAnimatedShapeItem,
  resolveAnimatedTransform,
  resolveExpressionReferenceValue,
  GROUP_HEADER_HEIGHT,
  KEYFRAME_EDGE_INSET,
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  moveItems,
  openComposition,
  removeKeyframes,
  removeVectorKeyframe,
  removeItems,
  ROW_HEIGHT,
  resolveDroppedMediaEntriesFromPayload,
  setTransformParents,
  setPropertyExpression,
  removePropertyExpression,
  setTracks,
  trimItemEnd,
  trimItemStart,
  updateItem,
  updateKeyframe,
  updateKeyframes,
  updateVectorKeyframe,
  upsertVectorKeyframe,
  promoteTransformToVector,
  setVectorDimensionsSeparated,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useKeyframesStore,
  useKeyframeSelectionStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  useRafCoalescedValue,
  usePropertyLinkPickWhip,
  wouldCreateCompositionCycle,
} from '@/features/editor/deps/timeline-motion'
import { getAnimatablePropertyBaseValue } from '@/features/editor/deps/keyframes'
import { useGizmoStore, useMaskEditorStore, type ItemPreview } from '@/features/editor/deps/preview'
import {
  getSourceDimensions,
  resolveItemTransformAtFrame,
  resolveTransform,
} from '@/features/editor/deps/composition-runtime'
import { worldToLocalTransform } from '@/shared/utils/transform-parenting'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import {
  beginTextMotionEdit,
  commitTextMotionEdit,
  trimCompositionToActiveRegion,
  updateTextMotionLive,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import {
  clearMediaDragData,
  getMediaDragData,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library-contract'
import { useComposeUiStore } from './compose-ui-store'
import { NewCompositionDialog } from './new-composition-dialog'
import { TransformParentPickWhipOverlay } from './transform-parent-pick-whip-overlay'
import { useTransformParentPickWhip } from './use-transform-parent-pick-whip'
import {
  getTransformParentRejection,
  getTransformParentRejectionMessage,
} from './transform-parent-validation'
import {
  buildMotionSelectionDragState,
  buildMotionSelectionFrameUpdates,
  buildMotionSelectionRetimeUpdates,
  getMotionCompositionSnapFrames,
  getMotionSelectionTimeRange,
  mergeMotionKeyframeSelection,
  type MotionSelectionDragState,
  type MotionSelectionFrameUpdates,
  type MotionSelectionTimeRange,
} from './motion-keyframe-selection'
import {
  buildMotionVectorSeparationProperties,
  canCombineMotionVectorRowWithoutBake,
  getMotionVectorProxy,
  getStoredMotionVectorKeyframeId,
  isMotionVectorRowSeparated,
  MOTION_VECTOR_ROW_DEFINITIONS,
  motionVectorSeparationNeedsBake,
  shouldUseMotionVectorRow,
  toMotionVectorProxyKeyframes,
} from './motion-vector-rows'
import { MotionIoLane, MOTION_IO_LANE_HEIGHT } from './motion-io-lane'
import { MotionActiveRegionOverlay, MotionCompEndRulerDim } from './motion-region-overlay'
import { getVisibleMotionPathProperties } from './motion-path-property-visibility'

const LAYER_COLUMN_WIDTH = 620
const LAYER_PARENT_COLUMN_WIDTH = 148
const LAYER_TIMING_COLUMN_WIDTH = 128
const LAYER_MODE_COLUMN_WIDTH = 100
const TIMELINE_CONTENT_LEFT = LAYER_COLUMN_WIDTH + 1
// Tick labels on top, the in/out render-range lane along the bottom.
const RULER_HEIGHT = 28 + MOTION_IO_LANE_HEIGHT
const LAYER_ROW_HEIGHT = 34
type GeneratedLayerKind = 'text' | 'solid' | 'gradient' | 'shape' | 'controller'
type GeneratedLayerPlacement = Parameters<typeof createDefaultSolidColorItem>[0]

function createGeneratedLayerItem(
  kind: GeneratedLayerKind,
  placement: GeneratedLayerPlacement,
): TimelineItem {
  switch (kind) {
    case 'text':
      return createTextTemplateItem({ placement, text: 'Text layer', label: 'Text layer' })
    case 'solid':
      return createDefaultSolidColorItem(placement)
    case 'gradient':
      return createDefaultGradientItem(placement)
    case 'shape':
      return createDefaultShapeItem({ ...placement, shapeType: 'rectangle' })
    case 'controller':
      return createDefaultControllerItem(placement)
  }
}
const RULER_DIVISIONS = 10
const PLAYHEAD_EDGE_SCROLL_ZONE_PX = 48
const PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND = 720
const EMPTY_LAYER_IDS: string[] = []
const NO_TRANSFORM_PARENT = '__none__'

interface TransformParentMenuSelection {
  value: string
  currentParentItemId: string | undefined
  childItemId: string
  itemById: Record<string, TimelineItem>
  keyframesByItemId: Record<string, ItemKeyframes>
  canvas: CanvasSettings
  t: TFunction
}

function applyTransformParentMenuSelection({
  value,
  currentParentItemId,
  childItemId,
  itemById,
  keyframesByItemId,
  canvas,
  t,
}: TransformParentMenuSelection): void {
  const nextParentItemId = value === NO_TRANSFORM_PARENT ? undefined : value
  if (nextParentItemId === currentParentItemId) return
  const rejection = nextParentItemId
    ? getTransformParentRejection({
        childItemId,
        parentItemId: nextParentItemId,
        itemById,
        keyframesByItemId,
      })
    : null
  if (rejection) {
    toast.error(getTransformParentRejectionMessage(t, rejection))
    return
  }
  const playback = usePlaybackStore.getState()
  setTransformParents({
    childItemIds: [childItemId],
    parentItemId: nextParentItemId,
    frame: playback.previewFrame ?? playback.currentFrame,
    canvas,
  })
}
const POSITION_VECTOR_ROW = MOTION_VECTOR_ROW_DEFINITIONS.find(
  (row) => row.property === 'position',
)!
const MAX_DIMENSION_BAKE_FRAMES = 10_000
const PROCEDURAL_HATCH =
  'repeating-linear-gradient(45deg, rgba(56,189,248,0.55) 0 2px, transparent 2px 5px)'

type ClipboardTimelineItem = Omit<TimelineItem, 'id'>
type CompositionById = Parameters<typeof wouldCreateCompositionCycle>[0]['compositionById']

function clipboardHasLinkedPair(
  items: ClipboardTimelineItem[],
  item: ClipboardTimelineItem,
): boolean {
  if (!item.linkedGroupId) return false
  return items.some(
    (candidate) =>
      candidate.linkedGroupId === item.linkedGroupId &&
      ((candidate.type === 'audio' && item.type === 'video') ||
        (candidate.type === 'video' && item.type === 'audio')),
  )
}

function createPastedLinkedGroupIds(items: ClipboardTimelineItem[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const item of items) {
    if (!item.linkedGroupId || result.has(item.linkedGroupId)) continue
    if (clipboardHasLinkedPair(items, item)) result.set(item.linkedGroupId, crypto.randomUUID())
  }
  return result
}

function wouldSkipPastedComposition(
  item: ClipboardTimelineItem,
  activeCompositionId: string | null,
  compositionById: CompositionById,
): boolean {
  if (!activeCompositionId || !('compositionId' in item)) return false
  if (typeof item.compositionId !== 'string') return false
  return wouldCreateCompositionCycle({
    parentCompositionId: activeCompositionId,
    insertedCompositionId: item.compositionId,
    compositionById,
  })
}

function createPastedLayerTrack(params: {
  item: ClipboardTimelineItem
  sourceTrack: TimelineTrack | undefined
  trackId: string
  order: number
  parentTrackId: string | undefined
}): TimelineTrack {
  const fallback: TimelineTrack = {
    id: params.trackId,
    name: params.item.label || params.item.type,
    kind: params.item.type === 'audio' ? 'audio' : 'video',
    order: params.order,
    height: LAYER_ROW_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  }
  return {
    ...(params.sourceTrack ?? fallback),
    id: params.trackId,
    name: `${params.sourceTrack?.name ?? params.item.label ?? params.item.type} copy`,
    order: params.order,
    parentTrackId: params.parentTrackId,
    isGroup: false,
    items: [],
  }
}

function createPastedLayer(params: {
  item: ClipboardTimelineItem
  index: number
  pasteFrame: number
  maxOrder: number
  parentTrackId: string | undefined
  activeCompositionId: string | null
  compositionById: CompositionById
  trackById: Map<string, TimelineTrack>
  linkedGroupIds: Map<string, string>
}): { track: TimelineTrack; item: TimelineItem } | null {
  if (wouldSkipPastedComposition(params.item, params.activeCompositionId, params.compositionById)) {
    return null
  }
  const trackId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  return {
    track: createPastedLayerTrack({
      item: params.item,
      sourceTrack: params.trackById.get(params.item.trackId),
      trackId,
      order: params.maxOrder + params.index + 1,
      parentTrackId: params.parentTrackId,
    }),
    item: {
      ...params.item,
      id: itemId,
      originId: itemId,
      trackId,
      from: Math.max(0, params.pasteFrame + params.item.from),
      linkedGroupId: params.item.linkedGroupId
        ? params.linkedGroupIds.get(params.item.linkedGroupId)
        : undefined,
    } as TimelineItem,
  }
}

function getVisibleLinkedItems(items: TimelineItem[]): TimelineItem[] {
  const hiddenAudioIds = new Set(
    items.flatMap((item) => {
      const companion = getLinkedAudioCompanion(items, item)
      return companion ? [companion.id] : []
    }),
  )
  return items.filter((item) => !hiddenAudioIds.has(item.id))
}

interface MotionTimeViewport {
  startFrame: number
  endFrame: number
}

interface MotionViewportPreviewElement {
  element: HTMLElement
  edgeInset: number
  usableWidth: number
  frame: number
  frameSpan: number | null
  clampToSurface: boolean
  left: string
  width: string
  willChange: string
}

interface MotionViewportPreviewPlayhead {
  element: HTMLElement
  width: number
  transform: string
  hidden: boolean | 'until-found'
}

interface MotionViewportPreviewRulerLabel {
  element: HTMLElement
  index: number
  text: string
}

interface MotionViewportPreviewGrid {
  element: HTMLElement
  edgeInset: number
  usableWidth: number
  frames: number[]
  framesAttribute: string
  cssText: string
  willChange: string
}

interface MotionViewportPreviewNavigator {
  element: HTMLElement
  startFrame: string
  endFrame: string
  thumb: HTMLElement
  thumbLeft: string
  thumbWidth: string
  trackWidth: number
}

interface MotionViewportPreviewState {
  baseViewport: MotionTimeViewport
  elements: MotionViewportPreviewElement[]
  grids: MotionViewportPreviewGrid[]
  playhead: MotionViewportPreviewPlayhead | null
  rulerLabels: MotionViewportPreviewRulerLabel[]
  navigator: MotionViewportPreviewNavigator | null
}

type MotionViewportUpdate = (viewport: MotionTimeViewport) => MotionTimeViewport

function resolveMotionInlinePixels(value: string, referenceWidth: number, fallback: number) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return value.trim().endsWith('%') ? (parsed / 100) * referenceWidth : parsed
}

const TextMotionTimelineLanes = memo(function TextMotionTimelineLanes({
  itemId,
  bands,
  timeViewport,
}: {
  itemId: string
  bands: TextMotionTimelineBand[]
  timeViewport: MotionTimeViewport
}) {
  const dragRef = useRef<{
    pointerId: number
    slot: TextMotionSlot
    startX: number
    startDurationFrames: number
    currentDurationFrames: number
    laneWidth: number
    before: ReturnType<typeof beginTextMotionEdit> | null
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [previewDurationBySlot, setPreviewDurationBySlot] = useState<
    Partial<Record<TextMotionSlot, number>>
  >({})
  const visibleFrameRange = Math.max(1, timeViewport.endFrame - timeViewport.startFrame)

  const beginDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, band: TextMotionTimelineBand) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const laneWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
      if (laneWidth <= 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        slot: band.slot,
        startX: event.clientX,
        startDurationFrames: band.durationFrames,
        currentDurationFrames: band.durationFrames,
        laneWidth,
        before: null,
      }
    },
    [],
  )

  const moveDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const deltaFrames = ((event.clientX - drag.startX) / drag.laneWidth) * visibleFrameRange
      if (!drag.before) {
        if (Math.abs(event.clientX - drag.startX) < 3) return
        drag.before = beginTextMotionEdit()
      }
      const directedDelta = drag.slot === 'out' ? -deltaFrames : deltaFrames
      const durationFrames = Math.max(1, Math.round(drag.startDurationFrames + directedDelta))
      if (durationFrames === drag.currentDurationFrames) return
      drag.currentDurationFrames = durationFrames
      // Keep the high-frequency preview local to these tiny band rows. A live
      // item-store write invalidates the full expanded dopesheet on every tick.
      setPreviewDurationBySlot((previous) => ({ ...previous, [drag.slot]: durationFrames }))
    },
    [visibleFrameRange],
  )

  const finishDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = null
      suppressClickRef.current = commit && drag.before !== null
      if (commit && drag.before) {
        updateTextMotionLive([itemId], drag.slot, {
          durationFrames: drag.currentDurationFrames,
        })
        commitTextMotionEdit(drag.before, { slot: drag.slot, itemIds: [itemId] })
      }
      setPreviewDurationBySlot((previous) => {
        if (previous[drag.slot] === undefined) return previous
        const next = { ...previous }
        delete next[drag.slot]
        return next
      })
    },
    [itemId],
  )

  const endDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishDurationDrag(event, true),
    [finishDurationDrag],
  )
  const cancelDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishDurationDrag(event, false),
    [finishDurationDrag],
  )

  const openAnimationInspector = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      useSelectionStore.getState().selectItems([itemId])
      const editor = useEditorStore.getState()
      editor.setRightSidebarOpen(true)
      editor.setClipInspectorTab('audio')
    },
    [itemId],
  )

  return (
    <div data-testid="motion-text-procedural-lanes">
      {bands.map((band) => {
        const previewDuration = previewDurationBySlot[band.slot] ?? band.durationFrames
        const durationDelta = previewDuration - band.durationFrames
        const previewFromFrame =
          band.slot === 'out' ? band.fromFrame - durationDelta : band.fromFrame
        const previewToFrame = band.slot === 'out' ? band.toFrame : band.toFrame + durationDelta
        const left = ((previewFromFrame - timeViewport.startFrame) / visibleFrameRange) * 100
        const width = ((previewToFrame - previewFromFrame) / visibleFrameRange) * 100
        return (
          <div key={band.slot} className="flex h-7 border-t border-border/45 bg-background/25">
            <div
              className="flex shrink-0 items-center border-r border-border pl-14 pr-2 text-[9px] text-sky-300/90"
              style={{ width: LAYER_COLUMN_WIDTH }}
            >
              <span className="w-8 uppercase tracking-[0.08em]">{band.slot}</span>
              <span className="truncate text-muted-foreground">{band.presetId}</span>
              <span className="ml-auto pl-2 tabular-nums text-muted-foreground/70">
                {previewDuration}f · {band.unitCount}u
              </span>
            </div>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden">
              <div data-motion-viewport-surface className="absolute inset-0 overflow-hidden">
                <div
                  data-testid={`motion-text-procedural-band-${band.slot}`}
                  data-motion-span-drag-visual
                  data-from-frame={previewFromFrame}
                  data-to-frame={previewToFrame}
                  className="absolute top-1/2 h-4 -translate-y-1/2 touch-none cursor-ew-resize rounded-sm border border-sky-300/45 bg-sky-400/10 transition-[border-color,background-color] hover:border-sky-200/80 hover:bg-sky-400/20 active:border-sky-100"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(0.5, width)}%`,
                    backgroundImage: PROCEDURAL_HATCH,
                  }}
                  title={`${band.presetId} · drag to change duration · ${previewDuration}f · ${band.unitCount} units`}
                  onPointerDown={(event) => beginDurationDrag(event, band)}
                  onPointerMove={moveDurationDrag}
                  onPointerUp={endDurationDrag}
                  onPointerCancel={cancelDurationDrag}
                  onClick={openAnimationInspector}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})

interface MotionMiddlePanState {
  startClientY: number
  startScrollTop: number
}
const MOTION_INLINE_PROPERTY_GROUP_IDS = ['crop', 'audio', 'effects'] as const
const MOTION_GRAPH_INLINE_PROPERTY_GROUP_IDS = [
  'transform',
  ...MOTION_INLINE_PROPERTY_GROUP_IDS,
] as const
const MOTION_INLINE_PROPERTY_GROUP_ID_SET: ReadonlySet<string> = new Set(
  MOTION_INLINE_PROPERTY_GROUP_IDS,
)
const logger = createLogger('MotionTimeline')

const ALL_BLEND_MODES = BLEND_MODE_GROUPS.flatMap((group) => group.modes)

interface LayerEntry {
  item: TimelineItem
  track: TimelineTrack | undefined
}

type MotionRow =
  | { kind: 'group'; track: TimelineTrack; items: TimelineItem[] }
  | { kind: 'layer'; item: TimelineItem; track: TimelineTrack | undefined; depth: number }

interface SpanDragState {
  pointerId: number
  startX: number
  laneWidth: number
  deltaFrames: number
  items: Array<{ id: string; from: number; durationInFrames: number }>
}

function setSpanDragVisualOffset(elements: readonly HTMLElement[], offsetPx: number) {
  const transform = `translateX(${offsetPx}px)`
  for (const element of elements) element.style.transform = transform
}

function clearSpanDragVisuals(elements: readonly HTMLElement[]) {
  for (const element of elements) {
    element.style.removeProperty('transform')
    element.style.removeProperty('will-change')
  }
}

interface SpanTrimState {
  pointerId: number
  itemId: string
  handle: 'start' | 'end'
  startX: number
  laneWidth: number
  deltaFrames: number
  from: number
  durationInFrames: number
  segment: HTMLButtonElement
  segmentWidthPx: number
  segmentInlineWidth: string
  segmentInlineTransform: string
  segmentInlineWillChange: string
  timelineVisuals: HTMLElement[]
}

function applySpanTrimVisuals(trim: SpanTrimState, visibleFrameRange: number) {
  const offsetPx = (trim.deltaFrames / visibleFrameRange) * trim.laneWidth
  trim.segment.style.transform =
    trim.handle === 'start' ? `translateX(${offsetPx}px)` : trim.segmentInlineTransform
  trim.segment.style.width = `${Math.max(
    1,
    trim.segmentWidthPx + (trim.handle === 'start' ? -offsetPx : offsetPx),
  )}px`
  if (trim.handle === 'start') setSpanDragVisualOffset(trim.timelineVisuals, offsetPx)
}

function clearSpanTrimVisuals(trim: SpanTrimState) {
  trim.segment.style.width = trim.segmentInlineWidth
  trim.segment.style.transform = trim.segmentInlineTransform
  trim.segment.style.willChange = trim.segmentInlineWillChange
  clearSpanDragVisuals(trim.timelineVisuals)
}

interface RowReorderDragState {
  pointerId: number
  sourceTrackId: string
  parentTrackId: string | null
  startY: number
  deltaY: number
  originIndex: number
  targetIndex: number
  sourceRow: HTMLElement
  dropCandidates: Array<{ trackId: string; centerY: number; row: HTMLElement }>
  dropIndicator: HTMLDivElement
}

interface MotionSelectionRetimeDragState {
  pointerId: number
  edge: 'start' | 'end'
  startClientX: number
  rulerWidth: number
  initialEdgeFrame: number
  selection: MotionSelectionDragState
  itemById: Record<string, TimelineItem>
  snapshot: ReturnType<typeof captureSnapshot>
  hasMoved: boolean
  lastUpdates: MotionSelectionFrameUpdates | null
  keyframeVisuals: MotionSelectionRetimeKeyframeVisual[]
  connectorVisuals: MotionSelectionRetimeConnectorVisual[]
  rangeVisual: MotionSelectionRetimeRangeVisual | null
}

interface MotionSelectionRetimeKeyframeVisual {
  element: HTMLButtonElement
  storageKey: string
  initialAbsoluteFrame: number
  inlineTransform: string
  inlineWillChange: string
}

interface MotionSelectionRetimeConnectorVisual {
  element: HTMLDivElement
  fromReferenceKey: string
  toReferenceKey: string
  initialLeft: number
  initialRight: number
  inlineLeft: string
  inlineWidth: string
  inlineWillChange: string
}

interface MotionSelectionRetimeRangeVisual {
  element: HTMLDivElement
  label: HTMLSpanElement | null
  startHandle: HTMLButtonElement | null
  endHandle: HTMLButtonElement | null
  inlineLeft: string
  inlineWidth: string
  inlineVisibility: string
  inlineWillChange: string
  title: string | null
  labelText: string | null
  labelDisplay: string | null
  startValueMin: string | null
  startValueMax: string | null
  startValueNow: string | null
  endValueMin: string | null
  endValueMax: string | null
  endValueNow: string | null
}

interface InlineCurveState {
  compositionId: string
  itemId: string
  property: AnimatableProperty
}

interface RenameTarget {
  kind: 'layer' | 'group'
  id: string
}

const MotionPlayheadOverlay = memo(function MotionPlayheadOverlay({
  timeViewport,
}: {
  timeViewport: MotionTimeViewport
}) {
  const playheadRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef(timeViewport)
  viewportRef.current = timeViewport

  const updatePosition = useCallback(() => {
    const element = playheadRef.current
    if (!element) return
    const viewport = viewportRef.current
    const playback = usePlaybackStore.getState()
    const displayFrame = playback.previewFrame ?? playback.currentFrame
    if (displayFrame < viewport.startFrame || displayFrame > viewport.endFrame) {
      element.hidden = true
      return
    }
    element.hidden = false
    const width = element.parentElement?.clientWidth ?? 0
    const visibleFrameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
    const x = ((displayFrame - viewport.startFrame) / visibleFrameRange) * width
    element.style.transform = `translate3d(${x}px, 0, 0)`
  }, [])

  useLayoutEffect(updatePosition, [timeViewport, updatePosition])
  useEffect(
    () =>
      usePlaybackStore.subscribe((state, previous) => {
        if (
          state.currentFrame !== previous.currentFrame ||
          state.previewFrame !== previous.previewFrame
        ) {
          updatePosition()
        }
      }),
    [updatePosition],
  )

  return (
    <div
      ref={playheadRef}
      data-testid="motion-playhead"
      className="pointer-events-none absolute inset-y-0 left-0 z-20 will-change-transform"
    >
      <PlayheadMarks handle="flag" bleedBottom />
    </div>
  )
})

interface VisibleMotionRetimeRange {
  startFrame: number
  endFrame: number
  widthPercent: number
}

function getVisibleMotionRetimeRange(
  range: ReturnType<typeof getMotionSelectionTimeRange>,
  viewport: MotionTimeViewport,
): VisibleMotionRetimeRange | null {
  if (!range || range.keyframeCount < 2 || range.startFrame >= range.endFrame) return null
  if (range.endFrame < viewport.startFrame || range.startFrame > viewport.endFrame) return null
  const startFrame = Math.max(viewport.startFrame, range.startFrame)
  const endFrame = Math.min(viewport.endFrame, range.endFrame)
  return {
    startFrame,
    endFrame,
    widthPercent:
      ((endFrame - startFrame) / Math.max(1, viewport.endFrame - viewport.startFrame)) * 100,
  }
}

function getRetimeKeyboardDelta(event: ReactKeyboardEvent<HTMLButtonElement>): number | null {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  return direction === 0 ? null : direction * (event.shiftKey ? 10 : 1)
}

function applyMotionSelectionFrameUpdates(updates: MotionSelectionFrameUpdates): void {
  const keyframesStore = useKeyframesStore.getState()
  if (updates.scalar.length > 0) {
    keyframesStore._updateKeyframes(
      updates.scalar.map((update) => ({
        itemId: update.itemId,
        property: update.property,
        keyframeId: update.keyframeId,
        updates: { frame: update.frame },
      })),
    )
  }
  for (const update of updates.vector) {
    keyframesStore._updateVectorKeyframe(update.itemId, update.property, update.keyframeId, {
      frame: update.frame,
    })
  }
}

function getMotionRetimeStorageKey(
  itemId: string,
  kind: 'scalar' | 'vector',
  property: string,
  keyframeId: string,
): string {
  return `${itemId}\u0000${kind}\u0000${property}\u0000${keyframeId}`
}

function getMotionRetimeReferenceKey(itemId: string, keyframeId: string): string {
  return `${itemId}\u0000${keyframeId}`
}

function captureMotionSelectionRetimeKeyframeVisuals(
  root: HTMLElement | null,
  selection: MotionSelectionDragState,
  itemById: Readonly<Record<string, TimelineItem>>,
): MotionSelectionRetimeKeyframeVisual[] {
  if (!root) return []
  const elementByReferenceKey = new Map<string, HTMLButtonElement>()
  for (const element of root.querySelectorAll<HTMLButtonElement>(
    '[data-motion-item-id][data-motion-keyframe-id]',
  )) {
    const itemId = element.dataset.motionItemId
    const keyframeId = element.dataset.motionKeyframeId
    if (itemId && keyframeId) {
      elementByReferenceKey.set(getMotionRetimeReferenceKey(itemId, keyframeId), element)
    }
  }

  return selection.entries.flatMap((entry) => {
    const item = itemById[entry.ref.itemId]
    const element = elementByReferenceKey.get(
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
    )
    if (!item || !element) return []
    return [
      {
        element,
        storageKey: getMotionRetimeStorageKey(
          entry.ref.itemId,
          entry.storage.kind,
          entry.storage.property,
          entry.storage.keyframeId,
        ),
        initialAbsoluteFrame: item.from + entry.initialFrame,
        inlineTransform: element.style.transform,
        inlineWillChange: element.style.willChange,
      },
    ]
  })
}

function captureMotionSelectionRetimeConnectorVisuals(
  root: HTMLElement | null,
  selection: MotionSelectionDragState,
): MotionSelectionRetimeConnectorVisual[] {
  if (!root) return []
  const selectedReferenceKeys = new Set(
    selection.entries.map((entry) =>
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
    ),
  )
  const visuals: MotionSelectionRetimeConnectorVisual[] = []
  for (const element of root.querySelectorAll<HTMLDivElement>(
    '[data-motion-item-id][data-motion-connector-from-keyframe-id][data-motion-connector-to-keyframe-id]',
  )) {
    const itemId = element.dataset.motionItemId
    const fromKeyframeId = element.dataset.motionConnectorFromKeyframeId
    const toKeyframeId = element.dataset.motionConnectorToKeyframeId
    if (!itemId || !fromKeyframeId || !toKeyframeId) continue
    const fromReferenceKey = getMotionRetimeReferenceKey(itemId, fromKeyframeId)
    const toReferenceKey = getMotionRetimeReferenceKey(itemId, toKeyframeId)
    if (
      !selectedReferenceKeys.has(fromReferenceKey) &&
      !selectedReferenceKeys.has(toReferenceKey)
    ) {
      continue
    }
    const initialLeft = Number.parseFloat(element.style.left)
    const initialWidth = Number.parseFloat(element.style.width)
    if (!Number.isFinite(initialLeft) || !Number.isFinite(initialWidth)) continue
    visuals.push({
      element,
      fromReferenceKey,
      toReferenceKey,
      initialLeft,
      initialRight: initialLeft + initialWidth,
      inlineLeft: element.style.left,
      inlineWidth: element.style.width,
      inlineWillChange: element.style.willChange,
    })
  }
  return visuals
}

function captureMotionSelectionRetimeRangeVisual(
  element: HTMLDivElement | null,
): MotionSelectionRetimeRangeVisual | null {
  if (!element) return null
  const label = element.querySelector<HTMLSpanElement>('[data-motion-selection-retime-label]')
  const startHandle = element.querySelector<HTMLButtonElement>(
    '[data-motion-selection-retime-edge="start"]',
  )
  const endHandle = element.querySelector<HTMLButtonElement>(
    '[data-motion-selection-retime-edge="end"]',
  )
  return {
    element,
    label,
    startHandle,
    endHandle,
    inlineLeft: element.style.left,
    inlineWidth: element.style.width,
    inlineVisibility: element.style.visibility,
    inlineWillChange: element.style.willChange,
    title: element.getAttribute('title'),
    labelText: label?.textContent ?? null,
    labelDisplay: label?.style.display ?? null,
    startValueMin: startHandle?.getAttribute('aria-valuemin') ?? null,
    startValueMax: startHandle?.getAttribute('aria-valuemax') ?? null,
    startValueNow: startHandle?.getAttribute('aria-valuenow') ?? null,
    endValueMin: endHandle?.getAttribute('aria-valuemin') ?? null,
    endValueMax: endHandle?.getAttribute('aria-valuemax') ?? null,
    endValueNow: endHandle?.getAttribute('aria-valuenow') ?? null,
  }
}

function buildMotionSelectionRetimePreview(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
): { absoluteFrameByStorageKey: Map<string, number>; range: MotionSelectionTimeRange } | null {
  const localFrameByStorageKey = new Map<string, number>()
  for (const update of updates.scalar) {
    localFrameByStorageKey.set(
      getMotionRetimeStorageKey(update.itemId, 'scalar', update.property, update.keyframeId),
      update.frame,
    )
  }
  for (const update of updates.vector) {
    localFrameByStorageKey.set(
      getMotionRetimeStorageKey(update.itemId, 'vector', update.property, update.keyframeId),
      update.frame,
    )
  }

  const absoluteFrameByStorageKey = new Map<string, number>()
  const absoluteFrames: number[] = []
  for (const entry of drag.selection.entries) {
    const item = drag.itemById[entry.ref.itemId]
    if (!item) continue
    const storageKey = getMotionRetimeStorageKey(
      entry.ref.itemId,
      entry.storage.kind,
      entry.storage.property,
      entry.storage.keyframeId,
    )
    const absoluteFrame = item.from + (localFrameByStorageKey.get(storageKey) ?? entry.initialFrame)
    absoluteFrameByStorageKey.set(storageKey, absoluteFrame)
    absoluteFrames.push(absoluteFrame)
  }
  if (absoluteFrames.length === 0) return null
  return {
    absoluteFrameByStorageKey,
    range: {
      startFrame: Math.min(...absoluteFrames),
      endFrame: Math.max(...absoluteFrames),
      keyframeCount: drag.selection.entries.length,
      itemCount: new Set(drag.selection.entries.map((entry) => entry.ref.itemId)).size,
    },
  }
}

function applyMotionSelectionRetimeVisuals(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
  viewport: MotionTimeViewport,
): void {
  const preview = buildMotionSelectionRetimePreview(drag, updates)
  if (!preview) return
  const visibleFrameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const offsetPxByReferenceKey = new Map<string, number>()
  for (const entry of drag.selection.entries) {
    const item = drag.itemById[entry.ref.itemId]
    if (!item) continue
    const storageKey = getMotionRetimeStorageKey(
      entry.ref.itemId,
      entry.storage.kind,
      entry.storage.property,
      entry.storage.keyframeId,
    )
    const initialAbsoluteFrame = item.from + entry.initialFrame
    const absoluteFrame = preview.absoluteFrameByStorageKey.get(storageKey) ?? initialAbsoluteFrame
    offsetPxByReferenceKey.set(
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
      ((absoluteFrame - initialAbsoluteFrame) / visibleFrameRange) * drag.rulerWidth,
    )
  }
  for (const visual of drag.keyframeVisuals) {
    const absoluteFrame =
      preview.absoluteFrameByStorageKey.get(visual.storageKey) ?? visual.initialAbsoluteFrame
    const offsetPx =
      ((absoluteFrame - visual.initialAbsoluteFrame) / visibleFrameRange) * drag.rulerWidth
    visual.element.style.transform = `translate3d(${offsetPx}px, 0, 0)`
    visual.element.style.willChange = 'transform'
  }
  for (const visual of drag.connectorVisuals) {
    const nextLeft = visual.initialLeft + (offsetPxByReferenceKey.get(visual.fromReferenceKey) ?? 0)
    const nextRight = visual.initialRight + (offsetPxByReferenceKey.get(visual.toReferenceKey) ?? 0)
    visual.element.style.left = `${Math.min(nextLeft, nextRight)}px`
    visual.element.style.width = `${Math.abs(nextRight - nextLeft)}px`
    visual.element.style.willChange = 'left, width'
  }

  const rangeVisual = drag.rangeVisual
  if (!rangeVisual) return
  const visibleRange = getVisibleMotionRetimeRange(preview.range, viewport)
  if (!visibleRange) {
    rangeVisual.element.style.visibility = 'hidden'
    return
  }
  const selectionDuration = preview.range.endFrame - preview.range.startFrame
  const layerSuffix = preview.range.itemCount === 1 ? '' : 's'
  rangeVisual.element.style.visibility = 'visible'
  rangeVisual.element.style.left = `${
    ((visibleRange.startFrame - viewport.startFrame) / visibleFrameRange) * 100
  }%`
  rangeVisual.element.style.width = `${Math.max(0.4, visibleRange.widthPercent)}%`
  rangeVisual.element.style.willChange = 'left, width'
  rangeVisual.element.title = `${preview.range.keyframeCount} selected keyframes across ${preview.range.itemCount} layer${layerSuffix} · ${selectionDuration}f`
  if (rangeVisual.label) {
    rangeVisual.label.textContent = `${preview.range.keyframeCount} keys · ${selectionDuration}f`
    rangeVisual.label.style.display = visibleRange.widthPercent >= 8 ? '' : 'none'
  }
  rangeVisual.startHandle?.setAttribute('aria-valuemax', String(preview.range.endFrame - 1))
  rangeVisual.startHandle?.setAttribute('aria-valuenow', String(preview.range.startFrame))
  rangeVisual.endHandle?.setAttribute('aria-valuemin', String(preview.range.startFrame + 1))
  rangeVisual.endHandle?.setAttribute('aria-valuenow', String(preview.range.endFrame))
}

function restoreMotionSelectionRetimeVisuals(
  drag: MotionSelectionRetimeDragState,
  restoreRange: boolean,
): void {
  for (const visual of drag.keyframeVisuals) {
    visual.element.style.transform = visual.inlineTransform
    visual.element.style.willChange = visual.inlineWillChange
  }
  for (const visual of drag.connectorVisuals) {
    if (restoreRange) {
      visual.element.style.left = visual.inlineLeft
      visual.element.style.width = visual.inlineWidth
    }
    visual.element.style.willChange = visual.inlineWillChange
  }
  const rangeVisual = drag.rangeVisual
  if (!rangeVisual) return
  rangeVisual.element.style.visibility = rangeVisual.inlineVisibility
  rangeVisual.element.style.willChange = rangeVisual.inlineWillChange
  if (!restoreRange) return
  rangeVisual.element.style.left = rangeVisual.inlineLeft
  rangeVisual.element.style.width = rangeVisual.inlineWidth
  if (rangeVisual.title === null) rangeVisual.element.removeAttribute('title')
  else rangeVisual.element.setAttribute('title', rangeVisual.title)
  if (rangeVisual.label) {
    rangeVisual.label.textContent = rangeVisual.labelText
    rangeVisual.label.style.display = rangeVisual.labelDisplay ?? ''
  }
  const restoreAttribute = (
    element: HTMLButtonElement | null,
    name: string,
    value: string | null,
  ) => {
    if (!element) return
    if (value === null) element.removeAttribute(name)
    else element.setAttribute(name, value)
  }
  restoreAttribute(rangeVisual.startHandle, 'aria-valuemin', rangeVisual.startValueMin)
  restoreAttribute(rangeVisual.startHandle, 'aria-valuemax', rangeVisual.startValueMax)
  restoreAttribute(rangeVisual.startHandle, 'aria-valuenow', rangeVisual.startValueNow)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuemin', rangeVisual.endValueMin)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuemax', rangeVisual.endValueMax)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuenow', rangeVisual.endValueNow)
}

function hasMotionSelectionRetimeChanges(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
): boolean {
  const initialFrameByStorageKey = new Map(
    drag.selection.entries.map((entry) => [
      getMotionRetimeStorageKey(
        entry.ref.itemId,
        entry.storage.kind,
        entry.storage.property,
        entry.storage.keyframeId,
      ),
      entry.initialFrame,
    ]),
  )
  return (
    updates.scalar.some(
      (update) =>
        initialFrameByStorageKey.get(
          getMotionRetimeStorageKey(update.itemId, 'scalar', update.property, update.keyframeId),
        ) !== update.frame,
    ) ||
    updates.vector.some(
      (update) =>
        initialFrameByStorageKey.get(
          getMotionRetimeStorageKey(update.itemId, 'vector', update.property, update.keyframeId),
        ) !== update.frame,
    )
  )
}

interface MotionSelectionRetimeRangeProps {
  range: ReturnType<typeof getMotionSelectionTimeRange>
  viewport: MotionTimeViewport
  durationInFrames: number
  frameToPercent: (frame: number) => number
  onBegin: (event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end') => void
  onMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onNudge: (edge: 'start' | 'end', deltaFrames: number) => void
  rangeRef: Ref<HTMLDivElement>
}

const MotionSelectionRetimeRange = memo(function MotionSelectionRetimeRange({
  range,
  viewport,
  durationInFrames,
  frameToPercent,
  onBegin,
  onMove,
  onEnd,
  onCancel,
  onNudge,
  rangeRef,
}: MotionSelectionRetimeRangeProps) {
  const visibleRange = getVisibleMotionRetimeRange(range, viewport)
  if (!range || !visibleRange) return null
  const selectionDuration = range.endFrame - range.startFrame
  const layerSuffix = range.itemCount === 1 ? '' : 's'
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
    const deltaFrames = getRetimeKeyboardDelta(event)
    if (deltaFrames === null) return
    event.preventDefault()
    event.stopPropagation()
    onNudge(edge, deltaFrames)
  }

  return (
    <div
      ref={rangeRef}
      data-testid="motion-selection-retime-range"
      className="pointer-events-none absolute bottom-0 z-10 h-1 rounded-full bg-primary/70 shadow-[0_0_0_1px_hsl(var(--background)),0_0_6px_hsl(var(--primary)/0.45)]"
      style={{
        left: `${frameToPercent(visibleRange.startFrame)}%`,
        width: `${Math.max(0.4, visibleRange.widthPercent)}%`,
      }}
      title={`${range.keyframeCount} selected keyframes across ${range.itemCount} layer${layerSuffix} · ${selectionDuration}f`}
    >
      {visibleRange.widthPercent >= 8 ? (
        <span
          data-motion-selection-retime-label
          className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-primary/30 bg-background/95 px-1 py-0.5 text-[8px] font-medium normal-case tracking-normal text-primary shadow-sm"
        >
          {range.keyframeCount} keys · {selectionDuration}f
        </span>
      ) : null}
      {range.startFrame >= viewport.startFrame ? (
        <button
          type="button"
          role="slider"
          data-motion-selection-retime-edge="start"
          aria-label="Retime selected keyframes start"
          aria-valuemin={0}
          aria-valuemax={range.endFrame - 1}
          aria-valuenow={range.startFrame}
          onPointerDown={(event) => onBegin(event, 'start')}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onCancel}
          onKeyDown={(event) => handleKeyDown(event, 'start')}
          className="pointer-events-auto absolute -bottom-1.5 -left-1.5 h-4 w-3 cursor-ew-resize touch-none rounded-sm border border-primary bg-background shadow-sm outline-none hover:bg-primary/15 focus-visible:ring-1 focus-visible:ring-primary"
        />
      ) : null}
      {range.endFrame <= viewport.endFrame ? (
        <button
          type="button"
          role="slider"
          data-motion-selection-retime-edge="end"
          aria-label="Retime selected keyframes end"
          aria-valuemin={range.startFrame + 1}
          aria-valuemax={Math.max(1, durationInFrames - 1)}
          aria-valuenow={range.endFrame}
          onPointerDown={(event) => onBegin(event, 'end')}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onCancel}
          onKeyDown={(event) => handleKeyDown(event, 'end')}
          className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-4 w-3 cursor-ew-resize touch-none rounded-sm border border-primary bg-background shadow-sm outline-none hover:bg-primary/15 focus-visible:ring-1 focus-visible:ring-primary"
        />
      ) : null}
    </div>
  )
})

/**
 * Property editors need the frame while paused/scrubbing, but feeding every
 * playback tick through React makes every expanded dopesheet rerender. During
 * playback the selector collapses to a stable sentinel; pausing publishes the
 * latest frame once so inputs and keyframe controls catch up immediately.
 */
function useSettledMotionFrame(): number {
  const [settledFrame, setSettledFrame] = useState(
    () => usePlaybackStore.getState().previewFrame ?? usePlaybackStore.getState().currentFrame,
  )
  const settledFrameRef = useRef(settledFrame)

  useEffect(
    () =>
      usePlaybackStore.subscribe((state) => {
        if (state.isPlaying || state.previewFrame !== null) return
        const nextFrame = state.currentFrame
        if (nextFrame === settledFrameRef.current) return
        settledFrameRef.current = nextFrame
        setSettledFrame(nextFrame)
      }),
    [],
  )

  return settledFrame
}

const MotionCompactNavigator = memo(function MotionCompactNavigator({
  viewport,
  contentFrameMax,
  minVisibleFrames,
  onViewportChange,
  onViewportPreviewStart,
  onViewportPreview,
}: {
  viewport: MotionTimeViewport
  contentFrameMax: number
  minVisibleFrames: number
  onViewportChange: (viewport: MotionTimeViewport) => void
  onViewportPreviewStart: () => void
  onViewportPreview: (viewport: MotionTimeViewport | null) => void
}) {
  const currentFrame = useSettledMotionFrame()
  return (
    <CompactNavigator
      viewport={viewport}
      currentFrame={currentFrame}
      contentFrameMax={contentFrameMax}
      minVisibleFrames={minVisibleFrames}
      onViewportChange={onViewportChange}
      onViewportPreviewStart={onViewportPreviewStart}
      onViewportPreview={onViewportPreview}
    />
  )
})

interface MotionRowContextMenuProps {
  children: ReactNode
  canGroup?: boolean
  canPaste: boolean
  onOpen: () => void
  onRename: () => void
  onGroup?: () => void
  onUngroup?: () => void
  onDuplicate: () => void
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
  deleteLabel?: string
}

const MotionRowContextMenu = memo(function MotionRowContextMenu({
  children,
  canGroup = false,
  canPaste,
  onOpen,
  onRename,
  onGroup,
  onUngroup,
  onDuplicate,
  onCopy,
  onPaste,
  onDelete,
  deleteLabel = 'Delete',
}: MotionRowContextMenuProps) {
  const { t } = useTranslation()
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen()}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48 text-xs">
        <ContextMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        {onGroup && (
          <ContextMenuItem onClick={onGroup} disabled={!canGroup}>
            <Group className="mr-2 h-3.5 w-3.5" />
            {t('editor.compose.groupSelected')}
          </ContextMenuItem>
        )}
        {onUngroup && (
          <ContextMenuItem onClick={onUngroup}>
            <Ungroup className="mr-2 h-3.5 w-3.5" />
            {t('editor.compose.ungroup')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDuplicate}>
          <CopyPlus className="mr-2 h-3.5 w-3.5" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopy}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
          <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
          Paste
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

interface MotionDopesheetLanesProps {
  item: TimelineItem
  itemById: Record<string, TimelineItem>
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  compositionDurationInFrames: number
  fps: number
  canvas: { width: number; height: number }
  propertyFilter: 'all' | 'keyframed'
  timeViewport: MotionTimeViewport
  inlineCurveProperty: AnimatableProperty | null
  paneMode?: 'lanes' | 'graph'
  disabled?: boolean
  onSelectItem: (itemId: string) => void
  onInlineCurveChange: (property: AnimatableProperty | null) => void
  onScrub: (frame: number) => void
  onTimeViewportChange: (viewport: MotionTimeViewport) => void
  onPropertyLinkPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string,
    property: DirectLinkableProperty,
  ) => void
  onRemovePropertyLink?: (itemId: string, property: DirectLinkableProperty) => void
  onSetPropertyExpression?: (
    itemId: string,
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  onRemovePropertyExpression?: (itemId: string, property: DirectLinkableProperty) => void
}

function areItemsEqualForMotionDopesheet(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true

  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])
  for (const key of keys) {
    // Text-motion bands are rendered by TextMotionTimelineLanes. Their live
    // duration edits do not affect keyframes or base property values, so they
    // must not invalidate the much heavier dopesheet subtree.
    if (key === 'textMotion') continue
    if (previousRecord[key] !== nextRecord[key]) return false
  }
  return true
}

// fallow-ignore-next-line complexity
function areMotionDopesheetLanesPropsEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    areItemsEqualForMotionDopesheet(previous.item, next.item) &&
    previous.compositionDurationInFrames === next.compositionDurationInFrames &&
    previous.fps === next.fps &&
    previous.canvas.width === next.canvas.width &&
    previous.canvas.height === next.canvas.height &&
    previous.propertyFilter === next.propertyFilter &&
    previous.timeViewport.startFrame === next.timeViewport.startFrame &&
    previous.timeViewport.endFrame === next.timeViewport.endFrame &&
    previous.inlineCurveProperty === next.inlineCurveProperty &&
    previous.paneMode === next.paneMode &&
    previous.disabled === next.disabled &&
    previous.onPropertyLinkPointerDown === next.onPropertyLinkPointerDown &&
    previous.onRemovePropertyLink === next.onRemovePropertyLink &&
    previous.onSetPropertyExpression === next.onSetPropertyExpression &&
    previous.onRemovePropertyExpression === next.onRemovePropertyExpression &&
    previous.itemById === next.itemById &&
    previous.itemKeyframes === next.itemKeyframes &&
    previous.properties.length === next.properties.length &&
    previous.properties.every((property, index) => property === next.properties[index])
  )
}

function useNearMotionScrollViewport(
  rootRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): boolean {
  const [isNearScrollViewport, setIsNearScrollViewport] = useState(
    () => !enabled || typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    if (!enabled) {
      setIsNearScrollViewport(true)
      return
    }
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const motionScrollRoot = node.closest('[data-testid="motion-layer-scroll-area"]')
    let isIntersecting = true
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        isIntersecting = entry.isIntersecting
        if (!entry.isIntersecting && node.contains(document.activeElement)) return
        setIsNearScrollViewport(entry.isIntersecting)
      },
      {
        root: motionScrollRoot,
        rootMargin: '160px 0px',
      },
    )
    const handleFocusOut = (event: FocusEvent) => {
      if (isIntersecting || node.contains(event.relatedTarget as Node | null)) return
      setIsNearScrollViewport(false)
    }
    observer.observe(node)
    node.addEventListener('focusout', handleFocusOut)
    return () => {
      observer.disconnect()
      node.removeEventListener('focusout', handleFocusOut)
    }
  }, [enabled, rootRef])
  return isNearScrollViewport
}

function getEstimatedMotionDopesheetLaneHeight({
  item,
  itemKeyframes,
  properties,
  propertyFilter,
  expandedGroups,
}: Pick<MotionDopesheetLanesProps, 'item' | 'itemKeyframes' | 'properties' | 'propertyFilter'> & {
  expandedGroups?: Readonly<Record<string, boolean>>
}): number {
  const supportsVectorTransform = item.type !== 'audio' && item.type !== 'adjustment'
  const hiddenPropertyRows = new Set<AnimatableProperty>(
    supportsVectorTransform
      ? MOTION_VECTOR_ROW_DEFINITIONS.filter(
          (row) =>
            properties.includes(row.primary) &&
            properties.includes(row.secondary) &&
            shouldUseMotionVectorRow(itemKeyframes, row),
        ).map((row) => row.secondary)
      : [],
  )
  const scalarKeyframesByProperty = new Map(
    (itemKeyframes?.properties ?? []).map((entry) => [entry.property, entry.keyframes] as const),
  )
  const keyframesByProperty = Object.fromEntries(
    properties.map((property) => [property, scalarKeyframesByProperty.get(property) ?? []]),
  ) as Partial<Record<AnimatableProperty, Keyframe[]>>
  const proceduralPropertyIds = new Set(
    getProceduralBands(item.motionModifiers, item.durationInFrames, item.from).keys(),
  )
  const visibleProperties =
    propertyFilter === 'keyframed'
      ? properties.filter((property) =>
          isMotionPropertyVisible(
            property,
            keyframesByProperty,
            itemKeyframes,
            proceduralPropertyIds,
          ),
        )
      : properties
  const renderedVisibleProperties = visibleProperties.filter(
    (property) => !hiddenPropertyRows.has(property),
  )
  if (propertyFilter === 'keyframed' && renderedVisibleProperties.length === 0) return ROW_HEIGHT
  const displayGroups = getPropertyDisplayGroups(renderedVisibleProperties)
  const nonInlineGroups = displayGroups.filter(
    (group) => !MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id),
  )
  const visiblePropertyCount = displayGroups.reduce(
    (count, group) =>
      MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id) || expandedGroups?.[group.id] !== false
        ? count + group.properties.length
        : count,
    0,
  )
  return Math.max(
    ROW_HEIGHT,
    visiblePropertyCount * ROW_HEIGHT + nonInlineGroups.length * GROUP_HEADER_HEIGHT,
  )
}

function getMotionDopesheetLaneHeight(
  paneMode: 'lanes' | 'graph',
  laneContentHeight: number,
): number | undefined {
  return paneMode === 'lanes' ? Math.max(ROW_HEIGHT, laneContentHeight) : undefined
}

function withoutPropertyExpressions(itemKeyframes: ItemKeyframes | undefined) {
  if (!itemKeyframes) return undefined
  return {
    ...itemKeyframes,
    propertyLinks: [...getDirectPropertyLinks(itemKeyframes)],
    expressions: [],
  }
}

function toMotionScalePercent(value: number, baseValue: number): number {
  return Math.abs(baseValue) <= Number.EPSILON ? 100 : (value / baseValue) * 100
}

function getMotionVectorValue(
  property: VectorAnimatableProperty,
  transform: ReturnType<typeof resolveTransform>,
  baseTransform: ReturnType<typeof resolveTransform>,
): { x: number; y: number } {
  if (property === 'position') return { x: transform.x, y: transform.y }
  if (property === 'scale') {
    return {
      x: toMotionScalePercent(transform.width, baseTransform.width),
      y: toMotionScalePercent(transform.height, baseTransform.height),
    }
  }
  return { x: transform.anchorX, y: transform.anchorY }
}

type GizmoPositionPreview = { x: number; y: number } | null

interface MotionPositionValueSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => GizmoPositionPreview
}

interface MotionScaleValueSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => { x: number; y: number } | null
  setSnapshot: (value: { x: number; y: number }) => void
  clear: () => void
}

function useMotionScaleValueSource(): MotionScaleValueSource {
  return useMemo(() => {
    const listeners = new Set<() => void>()
    let snapshot: { x: number; y: number } | null = null
    const emit = () => {
      for (const listener of listeners) listener()
    }
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
      setSnapshot: (value: { x: number; y: number }) => {
        if (snapshot?.x === value.x && snapshot.y === value.y) return
        snapshot = value
        emit()
      },
      clear: () => {
        if (snapshot === null) return
        snapshot = null
        emit()
      },
    }
  }, [])
}

interface MotionPositionValueContext {
  item: TimelineItem
  resolvedTransform: ResolvedTransform | null
  committedValue: { x: number; y: number } | null
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
}

function areMotionPositionsEqual(
  previous: GizmoPositionPreview,
  next: GizmoPositionPreview,
): boolean {
  return (
    previous === next ||
    (previous !== null && next !== null && previous.x === next.x && previous.y === next.y)
  )
}

function createMotionPositionValueSource(
  getContext: () => MotionPositionValueContext,
): MotionPositionValueSource {
  const listeners = new Set<() => void>()
  let unsubscribeFromGizmo: (() => void) | null = null
  let animationFrameId: number | null = null
  let cachedSnapshot: GizmoPositionPreview = null
  let emittedSnapshot: GizmoPositionPreview = null
  let acknowledgedHandoffId: number | null = null

  const cacheSnapshot = (next: GizmoPositionPreview): GizmoPositionPreview => {
    if (areMotionPositionsEqual(cachedSnapshot, next)) return cachedSnapshot
    cachedSnapshot = next
    return cachedSnapshot
  }

  const getSnapshot = (): GizmoPositionPreview => {
    const context = getContext()
    const gizmoState = useGizmoStore.getState()
    const active =
      gizmoState.activeGizmo?.itemId === context.item.id && gizmoState.previewTransform
        ? {
            interactionId: gizmoState.activeGizmo.interactionId,
            transform: gizmoState.previewTransform,
          }
        : null
    const handoff =
      !active && gizmoState.presentationHandoff?.itemId === context.item.id
        ? gizmoState.presentationHandoff
        : null

    if (!active && (!handoff || acknowledgedHandoffId === handoff.interactionId)) {
      return cacheSnapshot(null)
    }
    if (!context.resolvedTransform) return cacheSnapshot(null)
    if (active) acknowledgedHandoffId = null

    const target = active?.transform ?? handoff!.finalTransform
    const previewWorldTransform = {
      ...context.resolvedTransform,
      x: target.x,
      y: target.y,
    }
    const parentId = context.item.transformParent?.parentItemId
    const parent = parentId ? context.itemById[parentId] : undefined
    const parentWorldTransform = parent
      ? resolveItemTransformAtFrame(parent, {
          canvas: { ...context.canvas, fps: context.fps },
          frame: context.currentFrame,
          keyframes: context.allKeyframesByItemId[parent.id],
          getItem: (candidateId) => context.itemById[candidateId],
          getKeyframes: (candidateId) => context.allKeyframesByItemId[candidateId],
        })
      : undefined
    const local = worldToLocalTransform(
      previewWorldTransform,
      context.item.transformParent,
      parentWorldTransform,
    )

    if (
      handoff &&
      context.committedValue &&
      Math.abs(local.x - context.committedValue.x) < 0.001 &&
      Math.abs(local.y - context.committedValue.y) < 0.001
    ) {
      acknowledgedHandoffId = handoff.interactionId
      return cacheSnapshot(null)
    }

    return cacheSnapshot({ x: local.x, y: local.y })
  }

  const flush = () => {
    animationFrameId = null
    const next = getSnapshot()
    if (next === emittedSnapshot) return
    emittedSnapshot = next
    for (const listener of listeners) listener()
  }

  const schedule = () => {
    if (animationFrameId !== null) return
    animationFrameId = requestAnimationFrame(flush)
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        emittedSnapshot = getSnapshot()
        unsubscribeFromGizmo = useGizmoStore.subscribe(schedule)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unsubscribeFromGizmo?.()
        unsubscribeFromGizmo = null
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    },
    getSnapshot,
  }
}

function useMotionPositionValueSource(
  context: MotionPositionValueContext,
): MotionPositionValueSource {
  const contextRef = useRef(context)
  contextRef.current = context
  return useMemo(() => createMotionPositionValueSource(() => contextRef.current), [])
}

function findMotionVectorKeyframe(
  itemKeyframes: ItemKeyframes | undefined,
  property: VectorAnimatableProperty,
  keyframeId: string,
): VectorKeyframe | undefined {
  return itemKeyframes?.vectorProperties
    ?.find((candidate) => candidate.property === property)
    ?.keyframes.find((keyframe) => keyframe.id === keyframeId)
}

interface ResolvedMotionVectorReference {
  reference: KeyframeRef
  proxy: { property: VectorAnimatableProperty; axis: 'x' | 'y' }
  keyframe: VectorKeyframe
}

function resolveMotionVectorReference(
  itemKeyframes: ItemKeyframes | undefined,
  reference: KeyframeRef,
): ResolvedMotionVectorReference | null {
  const proxy = getMotionVectorProxy(reference.property)
  if (!proxy) return null
  const keyframe = findMotionVectorKeyframe(
    itemKeyframes,
    proxy.property,
    getStoredMotionVectorKeyframeId(reference.keyframeId, proxy.axis),
  )
  return keyframe ? { reference, proxy, keyframe } : null
}

function partitionMotionVectorReferences(
  itemKeyframes: ItemKeyframes | undefined,
  references: readonly KeyframeRef[],
): { scalar: KeyframeRef[]; vector: ResolvedMotionVectorReference[] } {
  const scalar: KeyframeRef[] = []
  const vector: ResolvedMotionVectorReference[] = []
  const seenVectorKeys = new Set<string>()
  for (const reference of references) {
    const resolved = resolveMotionVectorReference(itemKeyframes, reference)
    if (!resolved) {
      scalar.push(reference)
      continue
    }
    const vectorKey = `${resolved.proxy.property}:${resolved.keyframe.id}`
    if (seenVectorKeys.has(vectorKey)) continue
    seenVectorKeys.add(vectorKey)
    vector.push(resolved)
  }
  return { scalar, vector }
}

function getSelectedMotionVectorKeyframes(
  itemKeyframes: ItemKeyframes | undefined,
  selectedKeyframes: readonly KeyframeRef[],
  itemId: string,
  property: VectorAnimatableProperty,
): VectorKeyframe[] {
  return partitionMotionVectorReferences(
    itemKeyframes,
    selectedKeyframes.filter((reference) => reference.itemId === itemId),
  ).vector.flatMap((entry) => (entry.proxy.property === property ? [entry.keyframe] : []))
}

function useMotionPropertySystems(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
  relativeFrame: number
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  originalKeyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  selectedKeyframeValueByProperty: Partial<Record<AnimatableProperty, number>>
  paneMode: 'lanes' | 'graph'
  onPropertyLinkPointerDown: MotionDopesheetLanesProps['onPropertyLinkPointerDown']
  onRemovePropertyLink: MotionDopesheetLanesProps['onRemovePropertyLink']
}) {
  const {
    item,
    itemKeyframes,
    properties,
    canvas,
    fps,
    currentFrame,
    relativeFrame,
    itemById,
    allKeyframesByItemId,
    originalKeyframesByProperty,
    selectedKeyframeValueByProperty,
    paneMode,
    onPropertyLinkPointerDown,
    onRemovePropertyLink,
  } = params
  const buildValues = useCallback(
    (keyframes: ItemKeyframes | undefined) =>
      buildMotionPropertyValues({
        item,
        itemKeyframes: keyframes,
        properties,
        canvas,
        fps,
        currentFrame,
        relativeFrame,
        itemById,
        allKeyframesByItemId,
        originalKeyframesByProperty,
        selectedKeyframeValueByProperty,
      }),
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      item,
      itemById,
      originalKeyframesByProperty,
      properties,
      relativeFrame,
      selectedKeyframeValueByProperty,
    ],
  )
  const propertyValues = useMemo(() => buildValues(itemKeyframes), [buildValues, itemKeyframes])
  const preExpressionPropertyValues = useMemo(
    () => buildValues(withoutPropertyExpressions(itemKeyframes)),
    [buildValues, itemKeyframes],
  )
  const resolveExpressionReference = useCallback(
    (sourceItemId: string, sourceProperty: DirectLinkableProperty) =>
      resolveExpressionReferenceValue(sourceItemId, sourceProperty, {
        globalFrame: currentFrame,
        canvas: { ...canvas, fps },
        getItem: (candidateId) => itemById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      }),
    [allKeyframesByItemId, canvas, currentFrame, fps, itemById],
  )
  const propertyLinkSourceLabels = useMemo(
    () => buildPropertyLinkSourceLabels(itemKeyframes, itemById),
    [itemById, itemKeyframes],
  )
  const propertyLinkHandlers = useMemo(
    () =>
      buildPropertyLinkHandlers({
        itemId: item.id,
        paneMode,
        onPointerDown: onPropertyLinkPointerDown,
        onRemove: onRemovePropertyLink,
      }),
    [item.id, onPropertyLinkPointerDown, onRemovePropertyLink, paneMode],
  )
  return {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    propertyLinkSourceLabels,
    propertyLinkHandlers,
  }
}

interface MotionDopesheetContentProps extends MotionDopesheetLanesProps {
  initialExpandedGroups?: Readonly<Record<string, boolean>>
  onExpandedGroupsChange?: (expandedGroups: Record<string, boolean>) => void
  onRenderedHeightChange?: (height: number) => void
}

// This orchestration component coordinates independent memoized lane interactions.
// It is mounted only by the near-viewport shell below so its store subscriptions
// and property derivations never run for distant expanded rows.
// fallow-ignore-next-line complexity
const MotionDopesheetContent = memo(function MotionDopesheetContent({
  item,
  itemKeyframes,
  properties,
  compositionDurationInFrames,
  fps,
  canvas,
  propertyFilter,
  timeViewport,
  inlineCurveProperty,
  paneMode = 'lanes',
  disabled = false,
  onSelectItem,
  onInlineCurveChange,
  onScrub,
  onTimeViewportChange,
  onPropertyLinkPointerDown,
  onRemovePropertyLink,
  onSetPropertyExpression,
  onRemovePropertyExpression,
  initialExpandedGroups,
  onExpandedGroupsChange,
  onRenderedHeightChange,
  itemById,
}: MotionDopesheetContentProps) {
  const currentFrame = useSettledMotionFrame()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragSnapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null)
  const crossLayerDragRef = useRef<MotionSelectionDragState | null>(null)
  const pendingCrossLayerDeltaRef = useRef<number | null>(null)
  const crossLayerPreviewFrameRef = useRef<number | null>(null)
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 })
  const [expressionDockHeight, setExpressionDockHeight] = useState(0)
  const allKeyframesByItemId = useKeyframesStore((state) => state.keyframesByItemId)
  const _updateKeyframe = useKeyframesStore((state) => state._updateKeyframe)
  const _updateKeyframes = useKeyframesStore((state) => state._updateKeyframes)
  const _updateVectorKeyframe = useKeyframesStore((state) => state._updateVectorKeyframe)
  const selectedKeyframes = useKeyframeSelectionStore((state) => state.selectedKeyframes)
  const selectKeyframes = useKeyframeSelectionStore((state) => state.selectKeyframes)
  const clearKeyframeSelection = useKeyframeSelectionStore((state) => state.clearSelection)
  const setKeyframeEditorShortcutScopeActive = useEditorStore(
    (state) => state.setKeyframeEditorShortcutScopeActive,
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const updateSize = () => {
      const rect = root.getBoundingClientRect()
      setPaneSize({ width: rect.width || 820, height: rect.height })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => setKeyframeEditorShortcutScopeActive(false),
    [setKeyframeEditorShortcutScopeActive],
  )

  const scalarKeyframesByProperty = useMemo(() => {
    const byProperty = new Map(
      (itemKeyframes?.properties ?? []).map((entry) => [entry.property, entry.keyframes] as const),
    )
    return Object.fromEntries(
      properties.map((property) => [property, byProperty.get(property) ?? []]),
    ) as Partial<Record<AnimatableProperty, Keyframe[]>>
  }, [itemKeyframes, properties])

  const supportsVectorTransform = item.type !== 'audio' && item.type !== 'adjustment'
  const vectorBaseTransform = useMemo(
    () =>
      supportsVectorTransform
        ? resolveTransform(item, { ...canvas, fps }, getSourceDimensions(item))
        : null,
    [canvas, fps, item, supportsVectorTransform],
  )
  const motionVectorRows = useMemo(
    () =>
      supportsVectorTransform
        ? MOTION_VECTOR_ROW_DEFINITIONS.filter(
            (row) =>
              properties.includes(row.primary) &&
              properties.includes(row.secondary) &&
              shouldUseMotionVectorRow(itemKeyframes, row),
          )
        : [],
    [itemKeyframes, properties, supportsVectorTransform],
  )
  const positionDimensionsSeparated = isMotionVectorRowSeparated(itemKeyframes, POSITION_VECTOR_ROW)
  const hiddenPropertyRows = useMemo<AnimatableProperty[]>(
    () => motionVectorRows.map((row) => row.secondary),
    [motionVectorRows],
  )
  const originalKeyframesByProperty = useMemo(() => {
    const result = { ...scalarKeyframesByProperty }
    if (!vectorBaseTransform) return result
    for (const row of motionVectorRows) {
      const lane =
        itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === row.property) ??
        buildVectorPromotionPlan({
          property: row.property,
          itemKeyframes,
          baseTransform: vectorBaseTransform,
          createId: (frame) => `motion-${row.property}-${frame}`,
        }).vectorProperty
      result[row.primary] = toMotionVectorProxyKeyframes(lane.keyframes, 'x')
      result[row.secondary] = toMotionVectorProxyKeyframes(lane.keyframes, 'y')
    }
    return result
  }, [itemKeyframes, motionVectorRows, scalarKeyframesByProperty, vectorBaseTransform])

  const keyframesByProperty = useMemo(
    () =>
      Object.fromEntries(
        properties.map((property) => [
          property,
          (originalKeyframesByProperty[property] ?? []).map((keyframe) => ({
            ...keyframe,
            frame: item.from + keyframe.frame,
          })),
        ]),
      ),
    [item.from, originalKeyframesByProperty, properties],
  )

  const relativeFrame = Math.max(0, Math.min(item.durationInFrames - 1, currentFrame - item.from))
  const selectedKeyframeValueByProperty = useMemo(() => {
    const values: Partial<Record<AnimatableProperty, number>> = {}
    for (let index = selectedKeyframes.length - 1; index >= 0; index -= 1) {
      const reference = selectedKeyframes[index]!
      if (reference.itemId !== item.id || values[reference.property] !== undefined) continue
      const keyframe = (originalKeyframesByProperty[reference.property] ?? []).find(
        (candidate) => candidate.id === reference.keyframeId,
      )
      if (keyframe) values[reference.property] = keyframe.value
    }
    return values
  }, [item.id, originalKeyframesByProperty, selectedKeyframes])
  const {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    propertyLinkSourceLabels,
    propertyLinkHandlers,
  } = useMotionPropertySystems({
    item,
    itemKeyframes,
    properties,
    canvas,
    fps,
    currentFrame,
    relativeFrame,
    itemById,
    allKeyframesByItemId,
    originalKeyframesByProperty,
    selectedKeyframeValueByProperty,
    paneMode,
    onPropertyLinkPointerDown,
    onRemovePropertyLink,
  })
  const vectorResolvedTransform = useMemo(
    () =>
      vectorBaseTransform
        ? resolveAnimatedTransform(vectorBaseTransform, itemKeyframes, relativeFrame, {
            globalFrame: currentFrame,
            canvas: { ...canvas, fps },
            getItem: (candidateId) => itemById[candidateId],
            getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
          })
        : null,
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      itemById,
      itemKeyframes,
      relativeFrame,
      vectorBaseTransform,
    ],
  )
  const vectorPreExpressionTransform = useMemo(
    () =>
      vectorBaseTransform
        ? resolveAnimatedTransform(
            vectorBaseTransform,
            withoutPropertyExpressions(itemKeyframes),
            relativeFrame,
            {
              globalFrame: currentFrame,
              canvas: { ...canvas, fps },
              getItem: (candidateId) => itemById[candidateId],
              getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
            },
          )
        : null,
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      itemById,
      itemKeyframes,
      relativeFrame,
      vectorBaseTransform,
    ],
  )
  const selectedVectorValues = useMemo(() => {
    const values = new Map<VectorAnimatableProperty, VectorKeyframe['value']>()
    for (let index = selectedKeyframes.length - 1; index >= 0; index -= 1) {
      const reference = selectedKeyframes[index]!
      if (reference.itemId !== item.id) continue
      const proxy = getMotionVectorProxy(reference.property)
      if (!proxy || values.has(proxy.property)) continue
      const keyframe = findMotionVectorKeyframe(
        itemKeyframes,
        proxy.property,
        getStoredMotionVectorKeyframeId(reference.keyframeId, proxy.axis),
      )
      if (keyframe) values.set(proxy.property, keyframe.value)
    }
    return values
  }, [item.id, itemKeyframes, selectedKeyframes])
  const resolvedPositionValue =
    vectorBaseTransform && vectorResolvedTransform
      ? getMotionVectorValue('position', vectorResolvedTransform, vectorBaseTransform)
      : null
  const resolvedScaleValue =
    vectorBaseTransform && vectorResolvedTransform
      ? getMotionVectorValue('scale', vectorResolvedTransform, vectorBaseTransform)
      : null
  const positionValueSource = useMotionPositionValueSource({
    item,
    resolvedTransform: vectorResolvedTransform,
    committedValue: selectedVectorValues.get('position') ?? resolvedPositionValue,
    itemById,
    allKeyframesByItemId,
    canvas,
    fps,
    currentFrame,
  })
  const scaleValueSource = useMotionScaleValueSource()
  const committedScaleValue = selectedVectorValues.get('scale') ?? resolvedScaleValue
  useEffect(() => {
    const preview = scaleValueSource.getSnapshot()
    if (
      preview &&
      committedScaleValue &&
      Math.abs(preview.x - committedScaleValue.x) < 0.001 &&
      Math.abs(preview.y - committedScaleValue.y) < 0.001
    ) {
      scaleValueSource.clear()
    }
  }, [committedScaleValue, scaleValueSource])
  const resolveMotionVectorValueAtFrame = useCallback(
    (property: VectorAnimatableProperty, frame: number) => {
      if (!vectorBaseTransform) return null
      const resolved = resolveAnimatedTransform(vectorBaseTransform, itemKeyframes, frame, {
        globalFrame: item.from + frame,
        canvas: { ...canvas, fps },
        getItem: (candidateId) => itemById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      })
      return getMotionVectorValue(property, resolved, vectorBaseTransform)
    },
    [allKeyframesByItemId, canvas, fps, item.from, itemById, itemKeyframes, vectorBaseTransform],
  )
  const commitPositionDimensionMode = useCallback(
    (separated: boolean, bake: boolean) => {
      if (!vectorBaseTransform) return
      const frameCount = Math.max(1, item.durationInFrames)
      if (bake && frameCount > MAX_DIMENSION_BAKE_FRAMES) {
        toast.error('Position animation is too long to bake safely', {
          description: `This conversion would create ${frameCount.toLocaleString()} keyframes per lane.`,
        })
        return
      }

      const vectorProperty = itemKeyframes?.vectorProperties?.find(
        (candidate) => candidate.property === 'position',
      )
      const samples = bake
        ? Array.from({ length: frameCount }, (_, frame) => ({
            frame,
            value: resolveMotionVectorValueAtFrame('position', frame),
          })).filter(
            (sample): sample is { frame: number; value: { x: number; y: number } } =>
              sample.value !== null,
          )
        : []

      if (separated) {
        const scalarProperties = bake
          ? (['x', 'y'] as const).map((property) => ({
              property,
              keyframes: samples.map((sample) => ({
                id: crypto.randomUUID(),
                frame: sample.frame,
                value: sample.value[property],
                easing: 'linear' as const,
              })),
            }))
          : buildMotionVectorSeparationProperties({
              row: POSITION_VECTOR_ROW,
              vectorProperty,
              baseTransform: vectorBaseTransform,
            })
        clearKeyframeSelection()
        setVectorDimensionsSeparated(item.id, 'position', true, { scalarProperties })
        return
      }

      const nextVectorProperty = bake
        ? {
            property: 'position' as const,
            keyframes: samples.map((sample) => ({
              id: crypto.randomUUID(),
              frame: sample.frame,
              value: sample.value,
              easing: 'linear' as const,
            })),
          }
        : buildVectorPromotionPlan({
            property: 'position',
            itemKeyframes,
            baseTransform: vectorBaseTransform,
          }).vectorProperty
      clearKeyframeSelection()
      setVectorDimensionsSeparated(item.id, 'position', false, {
        vectorProperty: nextVectorProperty.keyframes.length > 0 ? nextVectorProperty : undefined,
      })
    },
    [
      clearKeyframeSelection,
      item.durationInFrames,
      item.id,
      itemKeyframes,
      resolveMotionVectorValueAtFrame,
      vectorBaseTransform,
    ],
  )
  const handlePositionDimensionModeChange = useCallback(
    (separated: boolean) => {
      const blockedTargets = separated
        ? new Set<DirectLinkableProperty>(['position'])
        : new Set<DirectLinkableProperty>(['x', 'y'])
      const hasLink = getDirectPropertyLinks(itemKeyframes).some((link) =>
        blockedTargets.has(link.targetProperty),
      )
      const hasExpression = itemKeyframes?.expressions?.some(
        (expression) =>
          expression.type === 'expression' && blockedTargets.has(expression.targetProperty),
      )
      if (hasLink || hasExpression) {
        toast.error(
          separated
            ? 'Remove the Position link or expression before separating dimensions'
            : 'Remove the X/Y links or expressions before combining dimensions',
        )
        return
      }

      const needsBake = separated
        ? motionVectorSeparationNeedsBake(
            itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === 'position'),
          )
        : !canCombineMotionVectorRowWithoutBake(itemKeyframes, POSITION_VECTOR_ROW)
      if (!needsBake) {
        commitPositionDimensionMode(separated, false)
        return
      }

      toast.warning(
        separated
          ? 'Separating Position removes spatial or velocity handles'
          : 'X and Y use different timing and cannot be combined directly',
        {
          description: 'Bake the visible motion to frame-aligned keys before converting?',
          duration: Infinity,
          action: {
            label: separated ? 'Bake & separate' : 'Bake & combine',
            onClick: () => commitPositionDimensionMode(separated, true),
          },
          cancel: { label: 'Cancel', onClick: () => undefined },
        },
      )
    },
    [commitPositionDimensionMode, itemKeyframes],
  )
  const dimensionSeparationByProperty = useMemo(
    () =>
      supportsVectorTransform && properties.includes('x') && properties.includes('y')
        ? {
            x: {
              label: 'Position',
              separated: positionDimensionsSeparated,
              onChange: handlePositionDimensionModeChange,
            },
          }
        : {},
    [
      handlePositionDimensionModeChange,
      positionDimensionsSeparated,
      properties,
      supportsVectorTransform,
    ],
  )
  const scaleAxesLinked = item.transform?.aspectRatioLocked !== false
  const applyMotionVectorAxisValue = useCallback(
    (
      property: VectorAnimatableProperty,
      currentValue: { x: number; y: number },
      axis: 'x' | 'y',
      value: number,
    ) => {
      const nextValue = { ...currentValue, [axis]: value }
      if (property !== 'scale' || !scaleAxesLinked) return nextValue
      const otherAxis = axis === 'x' ? 'y' : 'x'
      const ratio = Math.abs(currentValue[axis]) <= Number.EPSILON ? 1 : value / currentValue[axis]
      nextValue[otherAxis] = currentValue[otherAxis] * ratio
      return nextValue
    },
    [scaleAxesLinked],
  )
  const positionScrubPreviewRef = useRef<ItemPreview | null>(null)
  const positionScrubActiveRef = useRef(false)
  const {
    queue: queuePositionScrubPreview,
    flushNow: flushPositionScrubPreview,
    cancel: cancelPositionScrubPreview,
  } = useRafCoalescedValue(
    useCallback(
      (position: { x: number; y: number }) => {
        useGizmoStore.getState().setTransformPreview({
          [item.id]: position,
        })
      },
      [item.id],
    ),
  )
  const startPositionScrubPreview = useCallback(() => {
    if (positionScrubActiveRef.current) return
    positionScrubPreviewRef.current = useGizmoStore.getState().preview?.[item.id] ?? null
    positionScrubActiveRef.current = true
  }, [item.id])
  const restorePositionScrubPreview = useCallback(() => {
    if (!positionScrubActiveRef.current) return
    useGizmoStore.getState().replaceItemPreview(item.id, positionScrubPreviewRef.current)
    positionScrubPreviewRef.current = null
    positionScrubActiveRef.current = false
  }, [item.id])
  const previewPositionScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!vectorBaseTransform || !vectorResolvedTransform) return
      const currentValue = getMotionVectorValue(
        'position',
        vectorResolvedTransform,
        vectorBaseTransform,
      )
      queuePositionScrubPreview(applyMotionVectorAxisValue('position', currentValue, axis, value))
    },
    [
      applyMotionVectorAxisValue,
      queuePositionScrubPreview,
      vectorBaseTransform,
      vectorResolvedTransform,
    ],
  )
  const cancelPositionScrub = useCallback(() => {
    cancelPositionScrubPreview()
    restorePositionScrubPreview()
  }, [cancelPositionScrubPreview, restorePositionScrubPreview])
  const scaleScrubPreviewRef = useRef<ItemPreview | null>(null)
  const scaleScrubActiveRef = useRef(false)
  const {
    queue: queueScaleScrubPreview,
    flushNow: flushScaleScrubPreview,
    cancel: cancelScaleScrubPreview,
  } = useRafCoalescedValue(
    useCallback(
      (scale: { x: number; y: number }) => {
        scaleValueSource.setSnapshot(scale)
        if (!vectorBaseTransform) return
        useGizmoStore.getState().setTransformPreview({
          [item.id]: {
            width: vectorBaseTransform.width * (scale.x / 100),
            height: vectorBaseTransform.height * (scale.y / 100),
          },
        })
      },
      [item.id, scaleValueSource, vectorBaseTransform],
    ),
  )
  const startScaleScrubPreview = useCallback(() => {
    if (scaleScrubActiveRef.current) return
    scaleScrubPreviewRef.current = useGizmoStore.getState().preview?.[item.id] ?? null
    scaleScrubActiveRef.current = true
  }, [item.id])
  const restoreScaleScrubPreview = useCallback(() => {
    if (!scaleScrubActiveRef.current) return
    useGizmoStore.getState().replaceItemPreview(item.id, scaleScrubPreviewRef.current)
    scaleScrubPreviewRef.current = null
    scaleScrubActiveRef.current = false
  }, [item.id])
  const previewScaleScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!committedScaleValue) return
      queueScaleScrubPreview(applyMotionVectorAxisValue('scale', committedScaleValue, axis, value))
    },
    [applyMotionVectorAxisValue, committedScaleValue, queueScaleScrubPreview],
  )
  const cancelScaleScrub = useCallback(() => {
    cancelScaleScrubPreview()
    restoreScaleScrubPreview()
    scaleValueSource.clear()
  }, [cancelScaleScrubPreview, restoreScaleScrubPreview, scaleValueSource])
  useEffect(
    () => () => {
      cancelPositionScrubPreview()
      restorePositionScrubPreview()
      cancelScaleScrubPreview()
      restoreScaleScrubPreview()
      scaleValueSource.clear()
    },
    [
      cancelPositionScrubPreview,
      cancelScaleScrubPreview,
      restorePositionScrubPreview,
      restoreScaleScrubPreview,
      scaleValueSource,
    ],
  )
  const promoteMotionVectorProperty = useCallback(
    (
      property: VectorAnimatableProperty,
      frame: number,
      override?: { axis: 'x' | 'y'; value: number },
    ) => {
      if (!vectorBaseTransform) return
      const plan = buildVectorPromotionPlan({
        property,
        itemKeyframes,
        baseTransform: vectorBaseTransform,
        includeFrame: frame,
      })
      if (override) {
        plan.vectorProperty = {
          ...plan.vectorProperty,
          keyframes: plan.vectorProperty.keyframes.map((keyframe) =>
            keyframe.frame === frame
              ? {
                  ...keyframe,
                  value: applyMotionVectorAxisValue(
                    property,
                    keyframe.value,
                    override.axis,
                    override.value,
                  ),
                }
              : keyframe,
          ),
        }
      }
      promoteTransformToVector(item.id, plan.vectorProperty, plan.removeScalarProperties)
    },
    [applyMotionVectorAxisValue, item.id, itemKeyframes, vectorBaseTransform],
  )
  const handleMotionVectorValueCommit = useCallback(
    (
      property: VectorAnimatableProperty,
      axis: 'x' | 'y',
      value: number,
      options: { allowCreate: boolean },
    ) => {
      const selectedStoredKeyframes = getSelectedMotionVectorKeyframes(
        itemKeyframes,
        selectedKeyframes,
        item.id,
        property,
      )
      if (selectedStoredKeyframes.length > 0) {
        for (const keyframe of selectedStoredKeyframes) {
          updateVectorKeyframe(item.id, property, keyframe.id, {
            value: applyMotionVectorAxisValue(property, keyframe.value, axis, value),
          })
        }
        return true
      }

      const lane = itemKeyframes?.vectorProperties?.find(
        (candidate) => candidate.property === property,
      )
      const currentKeyframe = lane?.keyframes.find((keyframe) => keyframe.frame === relativeFrame)
      if (currentKeyframe) {
        updateVectorKeyframe(item.id, property, currentKeyframe.id, {
          value: applyMotionVectorAxisValue(property, currentKeyframe.value, axis, value),
        })
        return true
      }
      if (!options.allowCreate) return false
      if (!lane || lane.keyframes.length === 0) {
        promoteMotionVectorProperty(property, relativeFrame, { axis, value })
        return true
      }
      const currentValue = resolveMotionVectorValueAtFrame(property, relativeFrame)
      if (!currentValue) return false
      upsertVectorKeyframe(item.id, property, {
        frame: relativeFrame,
        value: applyMotionVectorAxisValue(property, currentValue, axis, value),
        easing: 'linear',
      })
      return true
    },
    [
      applyMotionVectorAxisValue,
      item.id,
      itemKeyframes,
      promoteMotionVectorProperty,
      relativeFrame,
      resolveMotionVectorValueAtFrame,
      selectedKeyframes,
    ],
  )
  const finishPositionScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      previewPositionScrub(axis, value)
      flushPositionScrubPreview()
      handleMotionVectorValueCommit('position', axis, value, { allowCreate: true })
      restorePositionScrubPreview()
    },
    [
      flushPositionScrubPreview,
      handleMotionVectorValueCommit,
      previewPositionScrub,
      restorePositionScrubPreview,
    ],
  )
  const finishScaleScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      previewScaleScrub(axis, value)
      flushScaleScrubPreview()
      handleMotionVectorValueCommit('scale', axis, value, { allowCreate: true })
      restoreScaleScrubPreview()
    },
    [
      flushScaleScrubPreview,
      handleMotionVectorValueCommit,
      previewScaleScrub,
      restoreScaleScrubPreview,
    ],
  )
  const compoundPropertyRows = useMemo(() => {
    if (!vectorBaseTransform || !vectorResolvedTransform || !vectorPreExpressionTransform) return {}
    return Object.fromEntries(
      motionVectorRows.map((row) => {
        const resolvedValue = getMotionVectorValue(
          row.property,
          vectorResolvedTransform,
          vectorBaseTransform,
        )
        const value = selectedVectorValues.get(row.property) ?? resolvedValue
        return [
          row.primary,
          {
            label: row.label,
            value,
            preExpressionValue: getMotionVectorValue(
              row.property,
              vectorPreExpressionTransform,
              vectorBaseTransform,
            ),
            unit: row.unit,
            showAxisLabels: row.property !== 'position' && row.property !== 'scale',
            linkProperty: row.property,
            liveValueSource:
              row.property === 'position'
                ? positionValueSource
                : row.property === 'scale'
                  ? scaleValueSource
                  : undefined,
            ...(row.property === 'position'
              ? {
                  onScrubStart: startPositionScrubPreview,
                  onScrubPreview: previewPositionScrub,
                  onScrubEnd: finishPositionScrub,
                  onScrubCancel: cancelPositionScrub,
                }
              : row.property === 'scale'
                ? {
                    onScrubStart: startScaleScrubPreview,
                    onScrubPreview: previewScaleScrub,
                    onScrubEnd: finishScaleScrub,
                    onScrubCancel: cancelScaleScrub,
                  }
                : {}),
            axisLink:
              row.property === 'scale'
                ? {
                    linked: scaleAxesLinked,
                    onChange: (linked: boolean) =>
                      updateItem(item.id, {
                        transform: { ...item.transform, aspectRatioLocked: linked },
                      }),
                  }
                : undefined,
            onCommit: (axis: 'x' | 'y', nextValue: number, options: { allowCreate: boolean }) =>
              handleMotionVectorValueCommit(row.property, axis, nextValue, options),
          },
        ]
      }),
    )
  }, [
    handleMotionVectorValueCommit,
    cancelPositionScrub,
    finishPositionScrub,
    finishScaleScrub,
    item.id,
    item.transform,
    motionVectorRows,
    positionValueSource,
    previewPositionScrub,
    previewScaleScrub,
    cancelScaleScrub,
    scaleAxesLinked,
    scaleValueSource,
    selectedVectorValues,
    startPositionScrubPreview,
    startScaleScrubPreview,
    vectorBaseTransform,
    vectorPreExpressionTransform,
    vectorResolvedTransform,
  ])
  const compoundSecondaryProperties = useMemo(
    () => Object.fromEntries(motionVectorRows.map((row) => [row.primary, row.secondary])),
    [motionVectorRows],
  )
  const selectedKeyframeIds = useMemo(
    () =>
      new Set(
        selectedKeyframes
          .filter((reference) => reference.itemId === item.id)
          .map((reference) => reference.keyframeId),
      ),
    [item.id, selectedKeyframes],
  )
  const compositionSnapFrames = useMemo(
    () => getMotionCompositionSnapFrames(allKeyframesByItemId, itemById, selectedKeyframes),
    [allKeyframesByItemId, itemById, selectedKeyframes],
  )
  const proceduralPropertyIds = useMemo(
    () =>
      new Set(getProceduralBands(item.motionModifiers, item.durationInFrames, item.from).keys()),
    [item.durationInFrames, item.from, item.motionModifiers],
  )
  const visibleProperties =
    propertyFilter === 'keyframed'
      ? properties.filter((property) =>
          isMotionPropertyVisible(
            property,
            originalKeyframesByProperty,
            itemKeyframes,
            proceduralPropertyIds,
          ),
        )
      : properties
  const renderedVisibleProperties = visibleProperties.filter(
    (property) => !hiddenPropertyRows.includes(property),
  )
  const visiblePropertyCount = renderedVisibleProperties.length
  const visiblePropertyGroupHeaderCount = getPropertyAccordionGroups(
    renderedVisibleProperties,
  ).filter((group) => !MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id)).length
  const laneContentHeight =
    visiblePropertyCount * ROW_HEIGHT + visiblePropertyGroupHeaderCount * GROUP_HEADER_HEIGHT
  const laneContentStructureKey = `${paneMode}:${renderedVisibleProperties.join('|')}`
  const [reportedLaneContent, setReportedLaneContent] = useState<{
    structureKey: string
    height: number
  } | null>(null)
  const renderedLaneContentHeight =
    reportedLaneContent?.structureKey === laneContentStructureKey
      ? reportedLaneContent.height
      : laneContentHeight
  const renderedLaneHeight = getMotionDopesheetLaneHeight(
    paneMode,
    renderedLaneContentHeight + expressionDockHeight,
  )
  useLayoutEffect(() => {
    if (renderedLaneHeight !== undefined) onRenderedHeightChange?.(renderedLaneHeight)
  }, [onRenderedHeightChange, renderedLaneHeight])
  const handleLaneContentHeightChange = useCallback(
    (height: number) => {
      setReportedLaneContent((current) => {
        if (current?.structureKey === laneContentStructureKey && current.height === height) {
          return current
        }
        return { structureKey: laneContentStructureKey, height }
      })
    },
    [laneContentStructureKey],
  )

  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>, options?: { preserveExternalSelection?: boolean }) => {
      const references: KeyframeRef[] = []
      for (const property of properties) {
        for (const keyframe of originalKeyframesByProperty[property] ?? []) {
          if (keyframeIds.has(keyframe.id)) {
            references.push({ itemId: item.id, property, keyframeId: keyframe.id })
          }
        }
      }
      const nextSelection = mergeMotionKeyframeSelection(
        useKeyframeSelectionStore.getState().selectedKeyframes,
        item.id,
        references,
        options?.preserveExternalSelection === true,
      )
      if (nextSelection.length === 0) clearKeyframeSelection()
      else selectKeyframes(nextSelection)
    },
    [clearKeyframeSelection, item.id, originalKeyframesByProperty, properties, selectKeyframes],
  )

  const applyCrossLayerPreview = useCallback(() => {
    crossLayerPreviewFrameRef.current = null
    const dragState = crossLayerDragRef.current
    const requestedDeltaFrames = pendingCrossLayerDeltaRef.current
    pendingCrossLayerDeltaRef.current = null
    if (!dragState || requestedDeltaFrames === null) return

    const updates = buildMotionSelectionFrameUpdates(dragState, requestedDeltaFrames)
    if (updates.scalar.length > 0) {
      _updateKeyframes(
        updates.scalar.map((update) => ({
          itemId: update.itemId,
          property: update.property,
          keyframeId: update.keyframeId,
          updates: { frame: update.frame },
        })),
      )
    }
    for (const update of updates.vector) {
      _updateVectorKeyframe(update.itemId, update.property, update.keyframeId, {
        frame: update.frame,
      })
    }
  }, [_updateKeyframes, _updateVectorKeyframe])

  const handleSelectionFrameDelta = useCallback(
    (deltaFrames: number, phase: 'preview' | 'commit' | 'cancel') => {
      if (!crossLayerDragRef.current?.spansMultipleItems) return false
      pendingCrossLayerDeltaRef.current = phase === 'cancel' ? 0 : deltaFrames
      if (phase !== 'preview') {
        if (crossLayerPreviewFrameRef.current !== null) {
          cancelAnimationFrame(crossLayerPreviewFrameRef.current)
        }
        applyCrossLayerPreview()
        if (phase === 'cancel') {
          dragSnapshotRef.current = null
          crossLayerDragRef.current = null
        }
        return true
      }
      if (crossLayerPreviewFrameRef.current === null) {
        crossLayerPreviewFrameRef.current = requestAnimationFrame(applyCrossLayerPreview)
      }
      return true
    },
    [applyCrossLayerPreview],
  )

  const handleDragStart = useCallback(() => {
    dragSnapshotRef.current = captureSnapshot()
    const keyframesState = useKeyframesStore.getState()
    crossLayerDragRef.current = buildMotionSelectionDragState(
      useKeyframeSelectionStore.getState().selectedKeyframes,
      keyframesState.keyframesByItemId,
      useItemsStore.getState().itemById,
    )
  }, [])
  const handleDragEnd = useCallback(() => {
    const snapshot = dragSnapshotRef.current
    if (!snapshot) return
    useTimelineCommandStore
      .getState()
      .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, snapshot)
    useTimelineSettingsStore.getState().markDirty()
    dragSnapshotRef.current = null
    crossLayerDragRef.current = null
    pendingCrossLayerDeltaRef.current = null
  }, [])
  const handleDragCancel = useCallback(() => {
    if (crossLayerPreviewFrameRef.current !== null) {
      cancelAnimationFrame(crossLayerPreviewFrameRef.current)
      crossLayerPreviewFrameRef.current = null
    }
    dragSnapshotRef.current = null
    crossLayerDragRef.current = null
    pendingCrossLayerDeltaRef.current = null
  }, [])

  useEffect(
    () => () => {
      if (crossLayerPreviewFrameRef.current !== null) {
        cancelAnimationFrame(crossLayerPreviewFrameRef.current)
      }
    },
    [],
  )

  const clampAbsoluteFrame = useCallback(
    (frame: number) =>
      Math.max(item.from, Math.min(item.from + item.durationInFrames - 1, Math.round(frame))),
    [item.durationInFrames, item.from],
  )
  const handleMotionKeyframeMove = useCallback(
    (reference: KeyframeRef, nextFrame: number, nextValue: number) => {
      const vectorReference = resolveMotionVectorReference(itemKeyframes, reference)
      if (vectorReference) {
        _updateVectorKeyframe(
          reference.itemId,
          vectorReference.proxy.property,
          vectorReference.keyframe.id,
          {
            frame: clampAbsoluteFrame(nextFrame) - item.from,
            value: {
              ...vectorReference.keyframe.value,
              [vectorReference.proxy.axis]: nextValue,
            },
          },
        )
        return
      }
      _updateKeyframe(reference.itemId, reference.property, reference.keyframeId, {
        frame: clampAbsoluteFrame(nextFrame) - item.from,
        value: nextValue,
      })
    },
    [_updateKeyframe, _updateVectorKeyframe, clampAbsoluteFrame, item.from, itemKeyframes],
  )
  const handleMotionSegmentEasingChange = useCallback(
    (
      references: KeyframeRef[],
      updates: Pick<Keyframe, 'easing'> & Partial<Pick<Keyframe, 'easingConfig'>>,
      options?: { commit?: boolean },
    ) => {
      const partitioned = partitionMotionVectorReferences(itemKeyframes, references)
      for (const vector of partitioned.vector) {
        if (options?.commit === false) {
          _updateVectorKeyframe(
            vector.reference.itemId,
            vector.proxy.property,
            vector.keyframe.id,
            updates,
          )
        } else {
          updateVectorKeyframe(
            vector.reference.itemId,
            vector.proxy.property,
            vector.keyframe.id,
            updates,
          )
        }
      }
      if (partitioned.scalar.length === 0) return
      if (options?.commit === false) {
        for (const reference of partitioned.scalar) {
          _updateKeyframe(reference.itemId, reference.property, reference.keyframeId, updates)
        }
        return
      }
      updateKeyframes(
        partitioned.scalar.map((reference) => ({
          itemId: reference.itemId,
          property: reference.property,
          keyframeId: reference.keyframeId,
          updates,
        })),
      )
    },
    [_updateKeyframe, _updateVectorKeyframe, itemKeyframes],
  )
  const handleRemoveMotionKeyframes = useCallback(
    (references: KeyframeRef[]) => {
      const partitioned = partitionMotionVectorReferences(itemKeyframes, references)
      for (const vector of partitioned.vector) {
        removeVectorKeyframe(item.id, vector.proxy.property, vector.keyframe.id)
      }
      if (partitioned.scalar.length > 0) removeKeyframes(partitioned.scalar)
      clearKeyframeSelection()
    },
    [clearKeyframeSelection, item.id, itemKeyframes],
  )

  // In Motion's embedded lane view, an animated-only filter with no keyed
  // properties should consume no vertical space beneath the layer header.
  // The full graph editor keeps its empty guidance because it owns the pane.
  if (paneMode === 'lanes' && propertyFilter === 'keyframed' && visiblePropertyCount === 0) {
    return null
  }

  return (
    <div
      ref={rootRef}
      inert={disabled ? true : undefined}
      aria-disabled={disabled}
      className={cn(
        'w-full bg-background/35',
        paneMode === 'graph' && 'h-full',
        disabled && 'opacity-60',
      )}
      style={{
        height: renderedLaneHeight,
      }}
      onPointerEnter={() => setKeyframeEditorShortcutScopeActive(true)}
      onPointerLeave={() => setKeyframeEditorShortcutScopeActive(false)}
      onFocusCapture={() => setKeyframeEditorShortcutScopeActive(true)}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget as Node | null
        if (!event.currentTarget.contains(nextFocused)) {
          setKeyframeEditorShortcutScopeActive(false)
        }
      }}
    >
      {paneSize.width > 0 ? (
        <DopesheetEditor
          itemId={item.id}
          motionModifiers={item.motionModifiers}
          hasProceduralMotion={hasEnabledProceduralMotion(item)}
          keyframesByProperty={keyframesByProperty}
          propertyValues={propertyValues}
          preExpressionPropertyValues={preExpressionPropertyValues}
          hiddenPropertyRows={hiddenPropertyRows}
          compoundPropertyRows={compoundPropertyRows}
          compoundSecondaryProperties={compoundSecondaryProperties}
          dimensionSeparationByProperty={dimensionSeparationByProperty}
          propertyLinks={getDirectPropertyLinks(itemKeyframes)}
          propertyExpressions={itemKeyframes?.expressions?.filter(
            (expression) => expression.type === 'expression',
          )}
          resolveExpressionReference={resolveExpressionReference}
          onSetPropertyExpression={
            onSetPropertyExpression
              ? (property, source, enabled) =>
                  onSetPropertyExpression(item.id, property, source, enabled)
              : undefined
          }
          onRemovePropertyExpression={
            onRemovePropertyExpression
              ? (property) => onRemovePropertyExpression(item.id, property)
              : undefined
          }
          onExpressionDockHeightChange={paneMode === 'lanes' ? setExpressionDockHeight : undefined}
          onLaneContentHeightChange={
            paneMode === 'lanes' ? handleLaneContentHeightChange : undefined
          }
          initialExpandedGroups={initialExpandedGroups}
          onExpandedGroupsChange={onExpandedGroupsChange}
          propertyLinkSourceLabels={propertyLinkSourceLabels}
          onPropertyLinkPointerDown={propertyLinkHandlers.onPointerDown}
          onRemovePropertyLink={propertyLinkHandlers.onRemove}
          selectedProperty={inlineCurveProperty}
          selectedKeyframeIds={selectedKeyframeIds}
          currentFrame={currentFrame}
          globalFrame={currentFrame}
          itemFrom={0}
          totalFrames={compositionDurationInFrames}
          fps={fps}
          width={paneSize.width}
          height={
            paneMode === 'graph'
              ? Math.max(120, paneSize.height)
              : Math.max(ROW_HEIGHT, renderedLaneContentHeight + expressionDockHeight)
          }
          frameViewport={timeViewport}
          onFrameViewportChange={onTimeViewportChange}
          onSelectionChange={handleSelectionChange}
          additionalSnapFrames={compositionSnapFrames}
          onSelectionFrameDelta={handleSelectionFrameDelta}
          onKeyframeMove={handleMotionKeyframeMove}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          onSegmentEasingChange={handleMotionSegmentEasingChange}
          onAddKeyframe={(property, frame) => {
            const absoluteFrame = clampAbsoluteFrame(frame)
            const propertyRelativeFrame = absoluteFrame - item.from
            const vectorProxy = getMotionVectorProxy(property)
            if (
              vectorProxy &&
              motionVectorRows.some((row) => row.property === vectorProxy.property)
            ) {
              const lane = itemKeyframes?.vectorProperties?.find(
                (candidate) => candidate.property === vectorProxy.property,
              )
              if (!lane || lane.keyframes.length === 0) {
                promoteMotionVectorProperty(vectorProxy.property, propertyRelativeFrame)
                return
              }
              const value = resolveMotionVectorValueAtFrame(
                vectorProxy.property,
                propertyRelativeFrame,
              )
              if (!value) return
              upsertVectorKeyframe(item.id, vectorProxy.property, {
                frame: propertyRelativeFrame,
                value,
                easing: 'linear',
              })
              return
            }
            const keyframes = originalKeyframesByProperty[property] ?? []
            addKeyframe(
              item.id,
              property,
              propertyRelativeFrame,
              interpolatePropertyValue(
                keyframes,
                propertyRelativeFrame,
                getAnimatablePropertyBaseValue(item, property, { ...canvas, fps }),
              ),
            )
          }}
          onPropertyValueCommit={(property, value, options) => {
            const propertyKeyframes = originalKeyframesByProperty[property] ?? []
            const selectedPropertyKeyframes = propertyKeyframes.filter((keyframe) =>
              selectedKeyframeIds.has(keyframe.id),
            )
            if (selectedPropertyKeyframes.length > 0) {
              updateKeyframes(
                selectedPropertyKeyframes.map((keyframe) => ({
                  itemId: item.id,
                  property,
                  keyframeId: keyframe.id,
                  updates: { value },
                })),
              )
              return
            }

            const existing = propertyKeyframes.find((keyframe) => keyframe.frame === relativeFrame)
            if (existing) updateKeyframe(item.id, property, existing.id, { value })
            else if (options?.allowCreate !== false) {
              addKeyframe(item.id, property, relativeFrame, value)
            }
          }}
          onRemoveKeyframes={handleRemoveMotionKeyframes}
          onNavigateToKeyframe={(frame) => onScrub(clampAbsoluteFrame(frame))}
          onScrub={(frame) =>
            onScrub(Math.max(0, Math.min(compositionDurationInFrames - 1, frame)))
          }
          onScrubStart={() => onSelectItem(item.id)}
          onActivePropertyChange={() => onSelectItem(item.id)}
          onPropertyChange={(property) => {
            if (!property) return
            onSelectItem(item.id)
            onInlineCurveChange(property)
          }}
          onCurveVisibilityChange={(property, visible) => {
            onSelectItem(item.id)
            onInlineCurveChange(visible ? property : null)
          }}
          visualizationMode={paneMode === 'graph' ? 'graph' : 'dopesheet'}
          presentation="lanes"
          propertyColumnWidth={paneMode === 'graph' ? 0 : LAYER_COLUMN_WIDTH}
          timelineGridDivisions={paneMode === 'lanes' ? RULER_DIVISIONS : undefined}
          singleCurveMode
          selectedCurveVisibleExternally={paneMode === 'lanes' && inlineCurveProperty !== null}
          propertyFilter={propertyFilter}
          proceduralFrameOffset={item.from}
          proceduralDurationInFrames={item.durationInFrames}
          showPlayhead={false}
          inlinePropertyGroupIds={
            paneMode === 'graph'
              ? MOTION_GRAPH_INLINE_PROPERTY_GROUP_IDS
              : MOTION_INLINE_PROPERTY_GROUP_IDS
          }
          spacious
        />
      ) : null}
    </div>
  )
}, areMotionDopesheetLanesPropsEqual)

const MotionDopesheetLanes = memo(function MotionDopesheetLanes(props: MotionDopesheetLanesProps) {
  const { item, itemKeyframes, properties, propertyFilter, paneMode = 'lanes' } = props
  const shellRef = useRef<HTMLDivElement>(null)
  const isNearScrollViewport = useNearMotionScrollViewport(shellRef, paneMode === 'lanes')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const estimatedHeight = useMemo(
    () =>
      getEstimatedMotionDopesheetLaneHeight({
        item,
        itemKeyframes,
        properties,
        propertyFilter,
        expandedGroups,
      }),
    [expandedGroups, item, itemKeyframes, properties, propertyFilter],
  )
  const heightStructureKey = `${propertyFilter}:${properties.join('|')}:${estimatedHeight}`
  const [reportedHeight, setReportedHeight] = useState<{
    structureKey: string
    height: number
  } | null>(null)
  const renderedHeight =
    reportedHeight?.structureKey === heightStructureKey ? reportedHeight.height : estimatedHeight
  const handleRenderedHeightChange = useCallback(
    (height: number) => {
      setReportedHeight((current) => {
        if (current?.structureKey === heightStructureKey && current.height === height)
          return current
        return { structureKey: heightStructureKey, height }
      })
    },
    [heightStructureKey],
  )
  const shouldRenderContent = paneMode === 'graph' || isNearScrollViewport

  return (
    <div
      ref={shellRef}
      data-testid={`motion-dopesheet-shell-${item.id}`}
      data-motion-dopesheet-near-viewport={isNearScrollViewport ? 'true' : 'false'}
      className={cn('w-full bg-background/35', paneMode === 'graph' && 'h-full')}
      style={{ height: getMotionDopesheetLaneHeight(paneMode, renderedHeight) }}
    >
      {shouldRenderContent ? (
        <MotionDopesheetContent
          {...props}
          initialExpandedGroups={expandedGroups}
          onExpandedGroupsChange={setExpandedGroups}
          onRenderedHeightChange={handleRenderedHeightChange}
        />
      ) : null}
    </div>
  )
}, areMotionDopesheetLanesPropsEqual)

function getItemProperties(item: TimelineItem): AnimatableProperty[] {
  return getAnimatablePropertiesForItem(item)
}

function getMotionLayerTypeIcon(itemType: TimelineItem['type']): LucideIcon {
  switch (itemType) {
    case 'video':
      return Video
    case 'audio':
      return Music
    case 'image':
      return ImageIcon
    case 'lottie':
      return Sticker
    case 'text':
      return Type
    case 'shape':
      return Square
    case 'adjustment':
      return Layers
    case 'controller':
      return Crosshair
    case 'composition':
      return Layers
    case 'subtitle':
      return Captions
    default:
      return itemType satisfies never
  }
}

function buildMotionPropertyValues(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
  relativeFrame: number
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  originalKeyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  selectedKeyframeValueByProperty: Partial<Record<AnimatableProperty, number>>
}): Partial<Record<AnimatableProperty, number>> {
  const resolvedTransform = resolveItemTransformAtFrame(params.item, {
    canvas: { ...params.canvas, fps: params.fps },
    frame: params.currentFrame,
    keyframes: params.itemKeyframes,
    getItem: (itemId) => params.itemById[itemId],
    getKeyframes: (itemId) => params.allKeyframesByItemId[itemId],
  })
  const resolvedShape =
    params.item.type === 'shape'
      ? resolveAnimatedShapeItem(params.item, params.itemKeyframes, params.relativeFrame, {
          globalFrame: params.currentFrame,
          canvas: { ...params.canvas, fps: params.fps },
          getItem: (itemId) => params.itemById[itemId],
          getKeyframes: (itemId) => params.allKeyframesByItemId[itemId],
        })
      : null
  return Object.fromEntries(
    params.properties.map((property) => {
      const selectedValue = params.selectedKeyframeValueByProperty[property]
      const value = isTransformAnimatableProperty(property)
        ? resolvedTransform[property]
        : resolvedShape && isShapeAnimatableProperty(property)
          ? getShapeAnimatableBaseValue(resolvedShape, property)
          : interpolatePropertyValue(
              params.originalKeyframesByProperty[property] ?? [],
              params.relativeFrame,
              getAnimatablePropertyBaseValue(params.item, property, {
                ...params.canvas,
                fps: params.fps,
              }),
            )
      return [property, selectedValue ?? value]
    }),
  )
}

function buildPropertyLinkSourceLabels(
  itemKeyframes: ItemKeyframes | undefined,
  itemById: Record<string, TimelineItem>,
): Partial<Record<DirectLinkableProperty, string>> {
  return Object.fromEntries(
    getDirectPropertyLinks(itemKeyframes).map((link) => {
      const sourceItem = itemById[link.sourceItemId]
      const sourceLabel = sourceItem?.label || sourceItem?.type || link.sourceItemId
      return [link.targetProperty, `${sourceLabel} -> ${link.sourceProperty}`]
    }),
  )
}

function isMotionPropertyVisible(
  property: AnimatableProperty,
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>,
  itemKeyframes: ItemKeyframes | undefined,
  proceduralPropertyIds: ReadonlySet<AnimatableProperty>,
): boolean {
  const hasKeys = (keyframesByProperty[property]?.length ?? 0) > 0
  const vectorProperty = getMotionVectorProxy(property)?.property
  const hasLink = getDirectPropertyLinks(itemKeyframes).some(
    (link) => link.targetProperty === property || link.targetProperty === vectorProperty,
  )
  const hasExpression = itemKeyframes?.expressions?.some(
    (expression) =>
      expression.type === 'expression' &&
      (expression.targetProperty === property || expression.targetProperty === vectorProperty),
  )
  return hasKeys || !!hasLink || !!hasExpression || proceduralPropertyIds.has(property)
}

function buildPropertyLinkHandlers(params: {
  itemId: string
  paneMode: MotionDopesheetLanesProps['paneMode']
  onPointerDown: MotionDopesheetLanesProps['onPropertyLinkPointerDown']
  onRemove: MotionDopesheetLanesProps['onRemovePropertyLink']
}): {
  onPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  onRemove?: (property: DirectLinkableProperty) => void
} {
  const onPointerDown = params.onPointerDown
    ? (event: ReactPointerEvent<HTMLButtonElement>, property: DirectLinkableProperty) =>
        params.onPointerDown?.(event, params.itemId, property)
    : undefined
  const onRemove = params.onRemove
    ? (property: DirectLinkableProperty) => params.onRemove?.(params.itemId, property)
    : undefined
  return { onPointerDown, onRemove }
}

function normalizeMotionTimeViewport(
  viewport: MotionTimeViewport,
  totalFrames: number,
  roundToFrames = true,
): MotionTimeViewport {
  const contentEnd = Math.max(1, Math.round(totalFrames))
  const requestedVisibleFrames = viewport.endFrame - viewport.startFrame
  const visibleFrames = Math.max(
    Math.min(1, contentEnd),
    Math.min(
      contentEnd,
      roundToFrames ? Math.round(requestedVisibleFrames) : requestedVisibleFrames,
    ),
  )
  const maxStart = Math.max(0, contentEnd - visibleFrames)
  const requestedStartFrame = roundToFrames ? Math.round(viewport.startFrame) : viewport.startFrame
  const startFrame = Math.max(0, Math.min(maxStart, requestedStartFrame))
  return { startFrame, endFrame: startFrame + visibleFrames }
}

function getMotionTimelinePanGesture(
  event: WheelEvent,
  lockedAxis: 'x' | 'y' | null,
): { axis: 'x' | 'y'; delta: number } | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.deltaX === 0 && event.deltaY === 0) return null
  const axis = lockedAxis ?? (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'x' : 'y')
  return { axis, delta: axis === 'x' ? event.deltaX : event.deltaY }
}

function getMotionPlayheadEdgeScrollVelocity(
  clientX: number,
  bounds: Pick<DOMRect, 'left' | 'right'>,
): number {
  const leftDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (clientX - bounds.left)
  if (leftDepth > 0) {
    return (
      -PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, leftDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }
  const rightDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (bounds.right - clientX)
  if (rightDepth > 0) {
    return (
      PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, rightDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }
  return 0
}

function panMotionTimeViewport(
  viewport: MotionTimeViewport,
  panPixels: number,
  timelineWidth: number,
  totalFrames: number,
): MotionTimeViewport {
  const currentRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const deltaFrames = (panPixels / Math.max(1, timelineWidth)) * currentRange
  return normalizeMotionTimeViewport(
    {
      startFrame: viewport.startFrame + deltaFrames,
      endFrame: viewport.endFrame + deltaFrames,
    },
    totalFrames,
    false,
  )
}

function zoomMotionTimeViewport(
  viewport: MotionTimeViewport,
  pivotRatio: number,
  zoomFactor: number,
  totalFrames: number,
  minVisibleFrames = 1,
): MotionTimeViewport {
  const currentRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const pivotFrame = viewport.startFrame + pivotRatio * currentRange
  const nextRange = Math.max(
    Math.min(totalFrames, Math.max(1, Math.round(minVisibleFrames))),
    Math.min(totalFrames, Math.round(currentRange * zoomFactor)),
  )
  return normalizeMotionTimeViewport(
    {
      startFrame: pivotFrame - pivotRatio * nextRange,
      endFrame: pivotFrame + (1 - pivotRatio) * nextRange,
    },
    totalFrames,
  )
}

function formatFrameTime(frame: number, fps: number): string {
  const seconds = frame / Math.max(1, fps)
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

interface CompositingTimelineProps {
  className?: string
  defaults?: { width: number; height: number; fps: number }
}

interface CompositingTimelineItemsSnapshot {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  itemById: Record<string, TimelineItem>
}

interface CompositingTimelineCoreProps extends CompositingTimelineProps {
  itemsSnapshot: CompositingTimelineItemsSnapshot
}

function isSameItemExceptPosition(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true
  if (previous.id !== next.id || previous.type !== next.type) return false

  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])
  for (const key of keys) {
    if (key === 'transform') continue
    if (!Object.is(previousRecord[key], nextRecord[key])) return false
  }

  const previousTransform = previous.transform
  const nextTransform = next.transform
  if (previousTransform === nextTransform) return true
  if (!previousTransform || !nextTransform) return false

  const previousTransformRecord = previousTransform as unknown as Record<string, unknown>
  const nextTransformRecord = nextTransform as unknown as Record<string, unknown>
  const transformKeys = new Set([
    ...Object.keys(previousTransformRecord),
    ...Object.keys(nextTransformRecord),
  ])
  for (const key of transformKeys) {
    if (key === 'x' || key === 'y') continue
    if (!Object.is(previousTransformRecord[key], nextTransformRecord[key])) return false
  }
  return true
}

function isTranslateOnlyItemsSnapshotChange(
  previous: CompositingTimelineItemsSnapshot,
  next: CompositingTimelineItemsSnapshot,
  itemId: string,
): boolean {
  if (previous === next) return false
  if (previous.tracks !== next.tracks || previous.items.length !== next.items.length) return false

  let changedItemFound = false
  for (let index = 0; index < previous.items.length; index += 1) {
    const previousItem = previous.items[index]
    const nextItem = next.items[index]
    if (!previousItem || !nextItem || previousItem.id !== nextItem.id) return false
    if (previousItem === nextItem) continue
    if (previousItem.id !== itemId || !isSameItemExceptPosition(previousItem, nextItem)) {
      return false
    }
    changedItemFound = true
  }
  return changedItemFound
}

function createLayerTrack(params: {
  id: string
  name: string
  kind: 'video' | 'audio'
  order: number
}): TimelineTrack {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    height: LAYER_ROW_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order: params.order,
    items: [],
  }
}

interface LayerFrameInputProps {
  label: string
  ariaLabel: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  disabled?: boolean
}

const LayerFrameInput = memo(function LayerFrameInput({
  label,
  ariaLabel,
  value,
  min,
  max,
  onCommit,
  disabled = false,
}: LayerFrameInputProps) {
  return (
    <label className="flex items-center gap-0.5 text-[8px] text-muted-foreground" title={ariaLabel}>
      <span className="sr-only">{label}</span>
      <input
        key={value}
        type="number"
        autoComplete="off"
        data-bwignore="true"
        defaultValue={value}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value)
          if (!Number.isFinite(parsed)) return
          const next = Math.max(min, Math.min(max, Math.round(parsed)))
          event.currentTarget.value = String(next)
          if (next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="h-5 w-14 rounded border border-input bg-background px-1.5 text-[9px] tabular-nums text-muted-foreground outline-none focus:border-primary/60"
        aria-label={ariaLabel}
      />
    </label>
  )
})

/**
 * Dedicated layer/property timeline for the Motion workspace.
 *
 * This surface intentionally does not render or import the classic Timeline.
 * It shares domain stores, playback, undoable actions, and the dope-sheet's
 * row and inline curve primitives with the rest of the application.
 */
// This workspace shell intentionally owns the composition-wide interaction state.
// fallow-ignore-next-line complexity
const CompositingTimelineCore = memo(function CompositingTimelineCore({
  className,
  defaults,
  itemsSnapshot,
}: CompositingTimelineCoreProps) {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [propertyFilter, setPropertyFilter] = useState<'all' | 'keyframed'>('all')
  const [inlineCurve, setInlineCurve] = useState<InlineCurveState | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const spanDragRef = useRef<SpanDragState | null>(null)
  const spanDragAnimationFrameRef = useRef<number | null>(null)
  const spanDragVisualsRef = useRef<HTMLElement[]>([])
  const spanTrimRef = useRef<SpanTrimState | null>(null)
  const spanTrimAnimationFrameRef = useRef<number | null>(null)
  const selectionAnchorIdRef = useRef<string | null>(null)
  const motionViewportPreviewRootRef = useRef<HTMLDivElement>(null)
  const motionViewportPreviewRef = useRef<MotionViewportPreviewState | null>(null)
  const motionTimeNavigatorRef = useRef<HTMLDivElement>(null)
  const motionScrollAreaRef = useRef<HTMLDivElement>(null)
  const motionRulerRef = useRef<HTMLDivElement>(null)
  const motionSelectionRetimeRangeRef = useRef<HTMLDivElement>(null)
  const selectionRetimeDragRef = useRef<MotionSelectionRetimeDragState | null>(null)
  const pendingSelectionRetimeFrameRef = useRef<number | null>(null)
  const selectionRetimeAnimationFrameRef = useRef<number | null>(null)
  const [rowReorderDrag, setRowReorderDrag] = useState<RowReorderDragState | null>(null)
  const rowReorderDragRef = useRef<RowReorderDragState | null>(null)
  const pendingRowReorderClientYRef = useRef<number | null>(null)
  const rowReorderAnimationFrameRef = useRef<number | null>(null)
  const {
    drag: propertyLinkDrag,
    begin: beginPropertyLinkDrag,
    remove: handleRemovePropertyLink,
  } = usePropertyLinkPickWhip()
  const handleSetPropertyExpression = useCallback(
    (itemId: string, property: DirectLinkableProperty, source: string, enabled: boolean) => {
      setPropertyExpression(itemId, {
        type: 'expression',
        targetProperty: property,
        source,
        enabled,
      })
    },
    [],
  )
  const handleRemovePropertyExpression = useCallback(
    (itemId: string, property: DirectLinkableProperty) => {
      removePropertyExpression(itemId, property)
    },
    [],
  )
  const [timeViewport, setTimeViewport] = useState<MotionTimeViewport>({
    startFrame: 0,
    endFrame: 1,
  })
  const timeViewportRef = useRef(timeViewport)
  timeViewportRef.current = timeViewport

  useEffect(
    () => () => {
      if (spanDragAnimationFrameRef.current !== null) {
        cancelAnimationFrame(spanDragAnimationFrameRef.current)
      }
      if (spanTrimAnimationFrameRef.current !== null) {
        cancelAnimationFrame(spanTrimAnimationFrameRef.current)
      }
      clearSpanDragVisuals(spanDragVisualsRef.current)
      if (spanTrimRef.current) clearSpanTrimVisuals(spanTrimRef.current)
    },
    [],
  )
  const wheelMotionViewportRef = useRef<MotionTimeViewport | null>(null)
  const wheelMotionViewportAnimationFrameRef = useRef<number | null>(null)
  const wheelMotionViewportCommitTimerRef = useRef<number | null>(null)
  const wheelMotionPanAxisRef = useRef<'x' | 'y' | null>(null)
  const [motionScrollbarWidth, setMotionScrollbarWidth] = useState(0)
  const [allPathVertexItemIds, setAllPathVertexItemIds] = useState<Set<string>>(() => new Set())
  const cancelQueuedMotionViewport = useCallback(() => {
    if (wheelMotionViewportCommitTimerRef.current !== null) {
      window.clearTimeout(wheelMotionViewportCommitTimerRef.current)
      wheelMotionViewportCommitTimerRef.current = null
    }
    if (wheelMotionViewportAnimationFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionViewportAnimationFrameRef.current)
      wheelMotionViewportAnimationFrameRef.current = null
    }
    wheelMotionViewportRef.current = null
    wheelMotionPanAxisRef.current = null
  }, [])
  const middlePanRef = useRef<MotionMiddlePanState | null>(null)
  const latestScrubFrameRef = useRef<number | null>(null)
  const scrubAnimationFrameRef = useRef<number | null>(null)
  const scrubAnimationTimeRef = useRef<number | null>(null)
  const playheadScrubPointerIdRef = useRef<number | null>(null)
  const playheadScrubClientXRef = useRef<number | null>(null)
  const playheadScrubSurfaceRef = useRef<HTMLDivElement | null>(null)
  const playheadScrubViewportRef = useRef<MotionTimeViewport | null>(null)
  const viewportCompositionIdRef = useRef<string | null>(null)
  const activeCompositionId = useCompositionNavigationStore((state) => state.activeCompositionId)
  const compositions = useCompositionsStore((state) => state.compositions)
  const compositionById = useCompositionsStore((state) => state.compositionById)
  const composition = useCompositionsStore(
    useCallback(
      (state) =>
        activeCompositionId ? (state.compositionById[activeCompositionId] ?? null) : null,
      [activeCompositionId],
    ),
  )
  const { items, tracks, itemById } = itemsSnapshot
  const keyframesByItemId = useKeyframesStore((state) => state.keyframesByItemId)
  const setScrubFrame = usePlaybackStore((state) => state.setScrubFrame)
  const setPreviewFrame = usePlaybackStore((state) => state.setPreviewFrame)
  const pause = usePlaybackStore((state) => state.pause)
  const selectedItemIds = useSelectionStore((state) => state.selectedItemIds)
  const selectItems = useSelectionStore((state) => state.selectItems)
  const selectedMotionKeyframes = useKeyframeSelectionStore((state) => state.selectedKeyframes)
  const maskEditingItemId = useMaskEditorStore((state) =>
    state.isEditing ? state.editingItemId : null,
  )
  const selectedPathVertexIndices = useMaskEditorStore((state) => state.selectedVertexIndices)
  const expandedLayerIds = useComposeUiStore(
    useCallback(
      (state) =>
        activeCompositionId
          ? (state.expandedLayerIdsByComposition[activeCompositionId] ?? EMPTY_LAYER_IDS)
          : EMPTY_LAYER_IDS,
      [activeCompositionId],
    ),
  )
  const toggleLayerExpanded = useComposeUiStore((state) => state.toggleLayerExpanded)
  const setAllLayersExpanded = useComposeUiStore((state) => state.setAllLayersExpanded)
  const pruneCompositionLayers = useComposeUiStore((state) => state.pruneCompositionLayers)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const canPasteLayers = useClipboardStore((state) => (state.itemsClipboard?.items.length ?? 0) > 0)

  const isComposite = composition?.editorKind === 'composite-2d'
  // The axis covers the comp *and* anything hanging past it; the comp's own end is
  // tracked separately so the overhang can be marked as outside the comp (and is
  // not what Zoom To Fit fits).
  const compositionEndFrame = composition ? Math.max(1, composition.durationInFrames) : null
  // Keep this a boolean selector so an I/O drag does not invalidate the whole
  // timeline on every frame. A full-comp range stays visible/editable after a
  // trim, but cannot be trimmed again.
  const canTrimToActiveRegion = useTimelineStore(
    useCallback(
      (state) => {
        const currentComposition = activeCompositionId
          ? useCompositionsStore.getState().getComposition(activeCompositionId)
          : null
        const currentCompositionEndFrame = currentComposition
          ? Math.max(1, currentComposition.durationInFrames)
          : compositionEndFrame
        return (
          isComposite &&
          state.inPoint !== null &&
          state.outPoint !== null &&
          state.outPoint > state.inPoint &&
          !(
            state.inPoint === 0 &&
            currentCompositionEndFrame !== null &&
            state.outPoint === currentCompositionEndFrame
          )
        )
      },
      [activeCompositionId, compositionEndFrame, isComposite],
    ),
  )
  const durationInFrames = Math.max(
    1,
    compositionEndFrame ?? 1,
    ...items.map((item) => item.from + item.durationInFrames),
  )
  const fps = composition?.fps ?? 30
  const transformParentCanvas = useMemo(
    () => ({
      width: composition?.width ?? 1920,
      height: composition?.height ?? 1080,
      fps,
    }),
    [composition?.height, composition?.width, fps],
  )
  const { drag: transformParentDrag, begin: beginTransformParentDrag } =
    useTransformParentPickWhip(transformParentCanvas)
  // Fit the entire composition before paint whenever Motion opens or switches
  // compositions. Subsequent duration changes only clamp the user's viewport,
  // so manual zoom/pan remains stable while editing.
  useLayoutEffect(() => {
    if (viewportCompositionIdRef.current !== activeCompositionId) {
      viewportCompositionIdRef.current = activeCompositionId
      setTimeViewport({ startFrame: 0, endFrame: durationInFrames })
      return
    }
    setTimeViewport((current) => normalizeMotionTimeViewport(current, durationInFrames))
  }, [activeCompositionId, durationInFrames])
  const updateTimeViewport = useCallback(
    (viewport: MotionTimeViewport, roundToFrames = true) => {
      const normalized = normalizeMotionTimeViewport(viewport, durationInFrames, roundToFrames)
      timeViewportRef.current = normalized
      setTimeViewport((current) =>
        current.startFrame === normalized.startFrame && current.endFrame === normalized.endFrame
          ? current
          : normalized,
      )
    },
    [durationInFrames],
  )
  const clearMotionTimeViewportPreview = useCallback(() => {
    const preview = motionViewportPreviewRef.current
    if (!preview) return
    for (const grid of preview.grids) {
      grid.element.dataset.motionGridFrames = grid.framesAttribute
      grid.element.style.cssText = grid.cssText
    }
    for (const target of preview.elements) {
      target.element.style.left = target.left
      target.element.style.width = target.width
      target.element.style.willChange = target.willChange
    }
    if (preview.playhead) {
      preview.playhead.element.style.transform = preview.playhead.transform
      preview.playhead.element.hidden = preview.playhead.hidden
    }
    for (const label of preview.rulerLabels) label.element.textContent = label.text
    if (preview.navigator) {
      preview.navigator.element.dataset.startFrame = preview.navigator.startFrame
      preview.navigator.element.dataset.endFrame = preview.navigator.endFrame
      preview.navigator.thumb.style.left = preview.navigator.thumbLeft
      preview.navigator.thumb.style.width = preview.navigator.thumbWidth
    }
    motionViewportPreviewRef.current = null
  }, [])
  const discardMotionTimeViewportPreview = useCallback(() => {
    const preview = motionViewportPreviewRef.current
    if (!preview) return
    for (const grid of preview.grids) grid.element.style.willChange = grid.willChange
    for (const target of preview.elements) {
      target.element.style.willChange = target.willChange
    }
    motionViewportPreviewRef.current = null
  }, [])
  const prepareMotionTimeViewportPreview = useCallback(() => {
    clearMotionTimeViewportPreview()
    const root = motionViewportPreviewRootRef.current
    if (!root) return

    const baseViewport = timeViewportRef.current
    const baseRange = Math.max(1, baseViewport.endFrame - baseViewport.startFrame)
    const grids: MotionViewportPreviewGrid[] = []
    for (const element of root.querySelectorAll<HTMLElement>('[data-motion-grid-frames]')) {
      const surface = element.closest<HTMLElement>('[data-motion-viewport-surface]')
      const surfaceWidth = Math.max(
        0,
        Number(surface?.dataset.motionViewportAxisWidth) || surface?.clientWidth || 0,
      )
      if (surfaceWidth <= 0) continue
      const edgeInset = Math.max(0, Number(surface?.dataset.motionViewportEdgeInset ?? 0))
      const usableWidth = Math.max(1, surfaceWidth - edgeInset * 2)
      const frames = (element.dataset.motionGridFrames ?? '')
        .split(',')
        .map(Number)
        .filter(Number.isFinite)
      if (frames.length === 0) continue
      grids.push({
        element,
        edgeInset,
        usableWidth,
        frames,
        framesAttribute: element.dataset.motionGridFrames ?? '',
        cssText: element.style.cssText,
        willChange: element.style.willChange,
      })
    }
    const elements: MotionViewportPreviewElement[] = []
    for (const surface of root.querySelectorAll<HTMLElement>('[data-motion-viewport-surface]')) {
      const surfaceWidth = Math.max(
        0,
        Number(surface.dataset.motionViewportAxisWidth) || surface.clientWidth,
      )
      if (surfaceWidth <= 0 || surface.hasAttribute('data-motion-ruler-surface')) continue
      const edgeInset = Math.max(0, Number(surface.dataset.motionViewportEdgeInset ?? 0))
      const usableWidth = Math.max(1, surfaceWidth - edgeInset * 2)
      for (const element of surface.querySelectorAll<HTMLElement>('*')) {
        if (
          element.closest<HTMLElement>('[data-motion-viewport-surface]') !== surface ||
          element.hasAttribute('data-motion-static-x') ||
          element.hasAttribute('data-motion-grid-frames') ||
          element.style.left === ''
        ) {
          continue
        }
        const hasInlineWidth = element.style.width !== ''
        const leftPx = resolveMotionInlinePixels(
          element.style.left,
          surfaceWidth,
          element.offsetLeft,
        )
        const widthPx = hasInlineWidth
          ? resolveMotionInlinePixels(element.style.width, surfaceWidth, element.offsetWidth)
          : 0
        const semanticRangeFromFrame = Number(element.dataset.fromFrame)
        const semanticPointFrame = Number(element.dataset.dopesheetFrame)
        const semanticFromFrame = Number.isFinite(semanticRangeFromFrame)
          ? semanticRangeFromFrame
          : semanticPointFrame
        const semanticToFrame = Number(element.dataset.toFrame)
        const hasSemanticFromFrame = Number.isFinite(semanticFromFrame)
        const hasSemanticToFrame = Number.isFinite(semanticToFrame)
        elements.push({
          element,
          edgeInset,
          usableWidth,
          frame: hasSemanticFromFrame
            ? semanticFromFrame
            : baseViewport.startFrame + ((leftPx - edgeInset) / usableWidth) * baseRange,
          frameSpan: hasInlineWidth
            ? hasSemanticFromFrame && hasSemanticToFrame
              ? semanticToFrame - semanticFromFrame
              : (widthPx / usableWidth) * baseRange
            : null,
          clampToSurface: element.hasAttribute('data-motion-viewport-clamp'),
          left: element.style.left,
          width: element.style.width,
          willChange: element.style.willChange,
        })
        element.style.willChange = hasInlineWidth ? 'left, width' : 'left'
      }
    }
    const playheadElement = root.querySelector<HTMLElement>('[data-testid="motion-playhead"]')
    const playheadWidth = playheadElement?.parentElement?.clientWidth ?? 0
    const rulerLabels = Array.from(
      root.querySelectorAll<HTMLElement>('[data-motion-ruler-label-index]'),
      (element) => ({
        element,
        index: Number(element.dataset.motionRulerLabelIndex ?? 0),
        text: element.textContent ?? '',
      }),
    )
    const navigatorElement = motionTimeNavigatorRef.current
    const navigatorThumb = navigatorElement?.querySelector<HTMLElement>(
      '[data-testid="keyframe-navigator-thumb"]',
    )
    const navigatorTrackWidth = navigatorThumb?.parentElement?.clientWidth ?? 0
    motionViewportPreviewRef.current = {
      baseViewport,
      elements,
      grids,
      playhead:
        playheadElement && playheadWidth > 0
          ? {
              element: playheadElement,
              width: playheadWidth,
              transform: playheadElement.style.transform,
              hidden: playheadElement.hidden,
            }
          : null,
      rulerLabels,
      navigator:
        navigatorElement && navigatorThumb
          ? {
              element: navigatorElement,
              startFrame: navigatorElement.dataset.startFrame ?? '',
              endFrame: navigatorElement.dataset.endFrame ?? '',
              thumb: navigatorThumb,
              thumbLeft: navigatorThumb.style.left,
              thumbWidth: navigatorThumb.style.width,
              trackWidth: navigatorTrackWidth,
            }
          : null,
    }
  }, [clearMotionTimeViewportPreview])
  const previewMotionTimeViewport = useCallback(
    (viewport: MotionTimeViewport | null, scrubPlayheadProgress?: number) => {
      if (!viewport) {
        clearMotionTimeViewportPreview()
        return
      }

      if (!motionViewportPreviewRef.current) prepareMotionTimeViewportPreview()
      const preview = motionViewportPreviewRef.current
      if (!preview) return
      const nextRange = Math.max(1, viewport.endFrame - viewport.startFrame)

      for (const grid of preview.grids) {
        const sharedGridRoot = grid.element.closest<HTMLElement>(
          '[data-motion-shared-grid-divisions]',
        )
        const sharedDivisionCount = Number(sharedGridRoot?.dataset.motionSharedGridDivisions)
        const sharedBorderWidth = Math.max(
          0,
          Number(sharedGridRoot?.dataset.motionSharedGridBorderWidth) || 0,
        )
        const usesSharedGrid = Number.isFinite(sharedDivisionCount) && sharedDivisionCount > 0
        const frames: number[] = []
        if (usesSharedGrid) {
          for (let index = 0; index <= sharedDivisionCount; index += 1) {
            frames.push(viewport.startFrame + (index / sharedDivisionCount) * nextRange)
          }
        } else {
          const tickStep = getNiceTickStep(nextRange)
          const firstTick = Math.floor(viewport.startFrame / tickStep) * tickStep
          for (let frame = firstTick; frame <= viewport.endFrame; frame += tickStep) {
            frames.push(frame)
          }
        }
        if (frames.length === 0) continue
        const gridOrigin = usesSharedGrid ? -sharedBorderWidth : grid.edgeInset
        const gridWidth = usesSharedGrid
          ? grid.usableWidth + grid.edgeInset * 2 + sharedBorderWidth
          : grid.usableWidth
        const firstX = Math.round(
          gridOrigin + ((frames[0]! - viewport.startFrame) / nextRange) * gridWidth,
        )
        const shadows: string[] = []
        for (let index = 1; index < frames.length; index += 1) {
          const x = Math.round(
            gridOrigin + ((frames[index]! - viewport.startFrame) / nextRange) * gridWidth,
          )
          shadows.push(`${x - firstX}px 0 currentColor`)
        }
        grid.element.dataset.motionGridFrames = frames.join(',')
        grid.element.style.cssText = `left: ${firstX}px; box-shadow: ${shadows.join(', ')}; will-change: left, box-shadow;`
      }
      for (const target of preview.elements) {
        const rawLeft =
          target.edgeInset + ((target.frame - viewport.startFrame) / nextRange) * target.usableWidth
        const clampX = (x: number) =>
          Math.max(target.edgeInset, Math.min(target.edgeInset + target.usableWidth, x))
        const left = target.clampToSurface ? clampX(rawLeft) : rawLeft
        target.element.style.left = `${left}px`
        if (target.frameSpan !== null) {
          const rawRight = rawLeft + (target.frameSpan / nextRange) * target.usableWidth
          const right = target.clampToSurface ? clampX(rawRight) : rawRight
          target.element.style.width = `${Math.max(0, right - left)}px`
        }
      }
      if (preview.playhead) {
        const playback = usePlaybackStore.getState()
        const frame = playback.previewFrame ?? playback.currentFrame
        const isScrubbing = scrubPlayheadProgress !== undefined
        preview.playhead.element.hidden = isScrubbing
          ? false
          : frame < viewport.startFrame || frame > viewport.endFrame
        const playheadX = isScrubbing
          ? Math.max(
              0,
              Math.min(
                Math.max(0, preview.playhead.width - 1),
                Math.max(0, Math.min(1, scrubPlayheadProgress)) * preview.playhead.width,
              ),
            )
          : ((frame - viewport.startFrame) / nextRange) * preview.playhead.width
        preview.playhead.element.style.transform = `translate3d(${playheadX}px, 0, 0)`
      }
      for (const label of preview.rulerLabels) {
        const frame = Math.round(viewport.startFrame + (label.index / RULER_DIVISIONS) * nextRange)
        label.element.textContent = formatFrameTime(frame, fps)
      }
      if (preview.navigator) {
        preview.navigator.element.dataset.startFrame = String(viewport.startFrame)
        preview.navigator.element.dataset.endFrame = String(viewport.endFrame)
        if (preview.navigator.trackWidth > 0) {
          const metrics = getKeyframeNavigatorThumbMetrics({
            viewport,
            contentFrameMax: durationInFrames,
            trackWidth: preview.navigator.trackWidth,
          })
          preview.navigator.thumb.style.left = `${metrics.thumbLeft}px`
          preview.navigator.thumb.style.width = `${metrics.thumbWidth}px`
        }
      }
    },
    [clearMotionTimeViewportPreview, durationInFrames, fps, prepareMotionTimeViewportPreview],
  )
  const commitMotionTimeViewport = useCallback(
    (viewport: MotionTimeViewport, roundToFrames = true) => {
      // Wheel preview is imperative and RAF-local. Settle synchronously so a
      // following discrete mouse notch cannot be overwritten by an older
      // deferred React viewport render.
      flushSync(() => updateTimeViewport(viewport, roundToFrames))
      discardMotionTimeViewportPreview()
    },
    [discardMotionTimeViewportPreview, updateTimeViewport],
  )
  const fitMotionTimeViewport = useCallback(() => {
    cancelQueuedMotionViewport()
    // Fit the active region when one is marked, else the comp itself — never the
    // content overhang past the comp end, which does not render. Read in/out at
    // click time so an IO drag doesn't re-render this whole timeline per frame.
    const { inPoint, outPoint } = useTimelineStore.getState()
    const fittedViewport =
      inPoint !== null && outPoint !== null && outPoint > inPoint
        ? { startFrame: inPoint, endFrame: outPoint }
        : { startFrame: 0, endFrame: compositionEndFrame ?? durationInFrames }
    previewMotionTimeViewport(fittedViewport)
    commitMotionTimeViewport(fittedViewport)
  }, [
    cancelQueuedMotionViewport,
    commitMotionTimeViewport,
    compositionEndFrame,
    durationInFrames,
    previewMotionTimeViewport,
  ])
  const trimAndFitMotionTimeViewport = useCallback(() => {
    if (!trimCompositionToActiveRegion()) return
    // Trimming rebases I/O to 0..newDuration. Reuse the same fit path as the
    // toolbar control so preview, navigator handoff and settled geometry stay
    // identical without reacting to unrelated duration changes.
    fitMotionTimeViewport()
  }, [fitMotionTimeViewport])
  useEffect(() => clearMotionTimeViewportPreview, [clearMotionTimeViewportPreview])
  const queueMotionViewportUpdate = useCallback(
    (update: MotionViewportUpdate) => {
      if (!wheelMotionViewportRef.current) prepareMotionTimeViewportPreview()
      const nextViewport = update(wheelMotionViewportRef.current ?? timeViewportRef.current)
      wheelMotionViewportRef.current = nextViewport

      if (wheelMotionViewportAnimationFrameRef.current === null) {
        wheelMotionViewportAnimationFrameRef.current = requestAnimationFrame(() => {
          wheelMotionViewportAnimationFrameRef.current = null
          const pendingViewport = wheelMotionViewportRef.current
          if (pendingViewport) {
            previewMotionTimeViewport(
              normalizeMotionTimeViewport(pendingViewport, durationInFrames, false),
            )
          }
        })
      }
      if (wheelMotionViewportCommitTimerRef.current !== null) {
        window.clearTimeout(wheelMotionViewportCommitTimerRef.current)
      }
      wheelMotionViewportCommitTimerRef.current = window.setTimeout(() => {
        wheelMotionViewportCommitTimerRef.current = null
        if (wheelMotionViewportAnimationFrameRef.current !== null) {
          cancelAnimationFrame(wheelMotionViewportAnimationFrameRef.current)
          wheelMotionViewportAnimationFrameRef.current = null
        }
        const finalViewport = wheelMotionViewportRef.current
        if (finalViewport) {
          const normalizedFinalViewport = normalizeMotionTimeViewport(
            finalViewport,
            durationInFrames,
            false,
          )
          // A saturated main thread can let the settle timer win before the
          // final queued RAF. Paint that exact endpoint synchronously so the
          // deferred React render inherits identical diamond/grid geometry.
          previewMotionTimeViewport(normalizedFinalViewport)
          wheelMotionViewportRef.current = null
          commitMotionTimeViewport(normalizedFinalViewport, false)
        } else {
          wheelMotionViewportRef.current = null
        }
        wheelMotionPanAxisRef.current = null
      }, 100)
    },
    [
      prepareMotionTimeViewportPreview,
      previewMotionTimeViewport,
      commitMotionTimeViewport,
      durationInFrames,
    ],
  )
  const prepareNavigatorMotionTimeViewportPreview = useCallback(() => {
    cancelQueuedMotionViewport()
    prepareMotionTimeViewportPreview()
  }, [cancelQueuedMotionViewport, prepareMotionTimeViewportPreview])
  useEffect(() => cancelQueuedMotionViewport, [cancelQueuedMotionViewport])
  useLayoutEffect(() => {
    const scrollArea = motionScrollAreaRef.current
    if (!scrollArea) return
    const updateScrollbarWidth = () => {
      const nextWidth = Math.max(0, scrollArea.offsetWidth - scrollArea.clientWidth)
      setMotionScrollbarWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    updateScrollbarWidth()
    const observer = new ResizeObserver(updateScrollbarWidth)
    observer.observe(scrollArea)
    return () => observer.disconnect()
  }, [])
  const visibleFrameRange = Math.max(1, timeViewport.endFrame - timeViewport.startFrame)
  const frameToMotionPercent = useCallback(
    (frame: number) => ((frame - timeViewport.startFrame) / visibleFrameRange) * 100,
    [timeViewport.startFrame, visibleFrameRange],
  )
  const compositeCompositions = useMemo(
    () => compositions.filter((candidate) => candidate.editorKind === 'composite-2d'),
    [compositions],
  )
  const dialogDefaults = defaults ?? {
    width: composition?.width ?? 1920,
    height: composition?.height ?? 1080,
    fps,
  }
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const expandedLayerIdSet = useMemo(() => new Set(expandedLayerIds), [expandedLayerIds])
  const activeInlineCurve = inlineCurve?.compositionId === activeCompositionId ? inlineCurve : null
  const motionSelectionDragState = useMemo(
    () => buildMotionSelectionDragState(selectedMotionKeyframes, keyframesByItemId, itemById),
    [itemById, keyframesByItemId, selectedMotionKeyframes],
  )
  const motionSelectionTimeRange = useMemo(
    () =>
      motionSelectionDragState
        ? getMotionSelectionTimeRange(motionSelectionDragState, itemById)
        : null,
    [itemById, motionSelectionDragState],
  )
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const hiddenLinkedAudioItemIds = useMemo(() => {
    const hidden = new Set<string>()
    for (const item of items) {
      const companion = getLinkedAudioCompanion(items, item)
      if (companion) hidden.add(companion.id)
    }
    return hidden
  }, [items])
  const expandMotionLayerItemIds = useCallback(
    (itemIds: readonly string[]): string[] => {
      const expanded = new Set(itemIds)
      for (const itemId of itemIds) {
        const item = items.find((candidate) => candidate.id === itemId)
        if (!item) continue
        const companion = getLinkedAudioCompanion(items, item)
        if (companion) expanded.add(companion.id)
      }
      return [...expanded]
    },
    [items],
  )
  const layerEntries = useMemo<LayerEntry[]>(
    () =>
      items
        .filter((item) => item.type !== 'subtitle' && !hiddenLinkedAudioItemIds.has(item.id))
        .map((item) => ({ item, track: trackById.get(item.trackId) }))
        .sort(
          (a, b) =>
            (a.track?.order ?? Number.MAX_SAFE_INTEGER) -
              (b.track?.order ?? Number.MAX_SAFE_INTEGER) ||
            a.item.from - b.item.from ||
            a.item.id.localeCompare(b.item.id),
        ),
    [hiddenLinkedAudioItemIds, items, trackById],
  )
  const activeCurveItem = activeInlineCurve
    ? (items.find((item) => item.id === activeInlineCurve.itemId) ?? null)
    : null
  const activeCurveTrack = activeCurveItem ? trackById.get(activeCurveItem.trackId) : undefined
  const activeCurveParentGroup = activeCurveTrack?.parentTrackId
    ? trackById.get(activeCurveTrack.parentTrackId)
    : undefined
  const isActiveCurveLocked =
    activeCurveTrack?.locked === true || activeCurveParentGroup?.locked === true
  const activeCurveProperties = useMemo(
    () => (activeCurveItem ? getItemProperties(activeCurveItem) : []),
    [activeCurveItem],
  )
  const canGroupSelectedLayers = useMemo(
    () =>
      new Set(
        layerEntries
          .filter((entry) => selectedItemIdSet.has(entry.item.id))
          .map((entry) => entry.track?.id)
          .filter((trackId): trackId is string => Boolean(trackId)),
      ).size >= 2,
    [layerEntries, selectedItemIdSet],
  )

  const applySelectionRetimePreview = useCallback(() => {
    selectionRetimeAnimationFrameRef.current = null
    const drag = selectionRetimeDragRef.current
    const targetFrame = pendingSelectionRetimeFrameRef.current
    pendingSelectionRetimeFrameRef.current = null
    if (!drag || targetFrame === null) return

    const updates = buildMotionSelectionRetimeUpdates(
      drag.selection,
      drag.itemById,
      drag.edge,
      targetFrame,
      durationInFrames,
    )
    drag.lastUpdates = updates
    applyMotionSelectionRetimeVisuals(drag, updates, timeViewportRef.current)
  }, [durationInFrames])

  const flushSelectionRetimePreview = useCallback(() => {
    if (selectionRetimeAnimationFrameRef.current !== null) {
      cancelAnimationFrame(selectionRetimeAnimationFrameRef.current)
    }
    applySelectionRetimePreview()
  }, [applySelectionRetimePreview])

  const beginSelectionRetime = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
      if (!motionSelectionDragState || !motionSelectionTimeRange) return
      const ruler = motionRulerRef.current
      if (!ruler) return
      event.preventDefault()
      event.stopPropagation()
      const rect = ruler.getBoundingClientRect()
      const keyframeVisuals = captureMotionSelectionRetimeKeyframeVisuals(
        motionScrollAreaRef.current,
        motionSelectionDragState,
        itemById,
      )
      selectionRetimeDragRef.current = {
        pointerId: event.pointerId,
        edge,
        startClientX: event.clientX,
        rulerWidth: Math.max(1, rect.width),
        initialEdgeFrame:
          edge === 'start'
            ? motionSelectionTimeRange.startFrame
            : motionSelectionTimeRange.endFrame,
        selection: motionSelectionDragState,
        itemById,
        snapshot: captureSnapshot(),
        hasMoved: false,
        lastUpdates: null,
        keyframeVisuals,
        connectorVisuals: captureMotionSelectionRetimeConnectorVisuals(
          motionScrollAreaRef.current,
          motionSelectionDragState,
        ),
        rangeVisual: captureMotionSelectionRetimeRangeVisual(motionSelectionRetimeRangeRef.current),
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [itemById, motionSelectionDragState, motionSelectionTimeRange],
  )

  const moveSelectionRetime = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = selectionRetimeDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const deltaFrames = Math.round(
        ((event.clientX - drag.startClientX) / drag.rulerWidth) * visibleFrameRange,
      )
      if (deltaFrames === 0 && !drag.hasMoved) return
      drag.hasMoved = true
      pendingSelectionRetimeFrameRef.current = drag.initialEdgeFrame + deltaFrames
      if (selectionRetimeAnimationFrameRef.current === null) {
        selectionRetimeAnimationFrameRef.current = requestAnimationFrame(
          applySelectionRetimePreview,
        )
      }
    },
    [applySelectionRetimePreview, visibleFrameRange],
  )

  const endSelectionRetime = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = selectionRetimeDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (drag.hasMoved) {
        flushSelectionRetimePreview()
        const updates = drag.lastUpdates
        if (updates && hasMotionSelectionRetimeChanges(drag, updates)) {
          flushSync(() => applyMotionSelectionFrameUpdates(updates))
          restoreMotionSelectionRetimeVisuals(drag, false)
          useTimelineCommandStore
            .getState()
            .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, drag.snapshot)
          useTimelineSettingsStore.getState().markDirty()
        } else {
          restoreMotionSelectionRetimeVisuals(drag, true)
        }
      }
      pendingSelectionRetimeFrameRef.current = null
      selectionRetimeDragRef.current = null
    },
    [flushSelectionRetimePreview],
  )

  const cancelSelectionRetime = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = selectionRetimeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (selectionRetimeAnimationFrameRef.current !== null) {
      cancelAnimationFrame(selectionRetimeAnimationFrameRef.current)
      selectionRetimeAnimationFrameRef.current = null
    }
    pendingSelectionRetimeFrameRef.current = null
    restoreMotionSelectionRetimeVisuals(drag, true)
    selectionRetimeDragRef.current = null
  }, [])

  const nudgeSelectionRetime = useCallback(
    (edge: 'start' | 'end', deltaFrames: number) => {
      if (!motionSelectionDragState || !motionSelectionTimeRange || deltaFrames === 0) return
      const snapshot = captureSnapshot()
      const currentEdgeFrame =
        edge === 'start' ? motionSelectionTimeRange.startFrame : motionSelectionTimeRange.endFrame
      applyMotionSelectionFrameUpdates(
        buildMotionSelectionRetimeUpdates(
          motionSelectionDragState,
          itemById,
          edge,
          currentEdgeFrame + deltaFrames,
          durationInFrames,
        ),
      )
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, snapshot)
      useTimelineSettingsStore.getState().markDirty()
    },
    [durationInFrames, itemById, motionSelectionDragState, motionSelectionTimeRange],
  )

  useEffect(
    () => () => {
      if (selectionRetimeAnimationFrameRef.current !== null) {
        cancelAnimationFrame(selectionRetimeAnimationFrameRef.current)
      }
      const drag = selectionRetimeDragRef.current
      if (drag) restoreMotionSelectionRetimeVisuals(drag, true)
      pendingSelectionRetimeFrameRef.current = null
      selectionRetimeDragRef.current = null
    },
    [],
  )
  const motionRows = useMemo<MotionRow[]>(() => {
    const rows: MotionRow[] = []
    const entriesByTrackId = new Map<string, LayerEntry[]>()
    for (const entry of layerEntries) {
      const entries = entriesByTrackId.get(entry.item.trackId) ?? []
      entries.push(entry)
      entriesByTrackId.set(entry.item.trackId, entries)
    }

    const sortedTracks = [...tracks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    const emittedItemIds = new Set<string>()
    for (const track of sortedTracks.filter((candidate) => !candidate.parentTrackId)) {
      if (track.isGroup) {
        const childTracks = sortedTracks.filter((candidate) => candidate.parentTrackId === track.id)
        const childItems = childTracks.flatMap((child) =>
          (entriesByTrackId.get(child.id) ?? []).map((entry) => entry.item),
        )
        rows.push({ kind: 'group', track, items: childItems })
        if (!track.isCollapsed) {
          for (const childTrack of childTracks) {
            for (const entry of entriesByTrackId.get(childTrack.id) ?? []) {
              emittedItemIds.add(entry.item.id)
              rows.push({ kind: 'layer', ...entry, depth: 1 })
            }
          }
        } else {
          childItems.forEach((item) => emittedItemIds.add(item.id))
        }
        continue
      }

      for (const entry of entriesByTrackId.get(track.id) ?? []) {
        emittedItemIds.add(entry.item.id)
        rows.push({ kind: 'layer', ...entry, depth: 0 })
      }
    }

    for (const entry of layerEntries) {
      if (!emittedItemIds.has(entry.item.id)) {
        rows.push({ kind: 'layer', ...entry, depth: entry.track?.parentTrackId ? 1 : 0 })
      }
    }
    return rows
  }, [layerEntries, tracks])
  const visibleLayerIds = useMemo(
    () => motionRows.flatMap((row) => (row.kind === 'layer' ? [row.item.id] : [])),
    [motionRows],
  )

  useEffect(() => {
    if (!activeCompositionId) return
    pruneCompositionLayers(
      activeCompositionId,
      layerEntries.map((entry) => entry.item.id),
    )
  }, [activeCompositionId, layerEntries, pruneCompositionLayers])

  useEffect(() => {
    if (!activeInlineCurve) return
    const itemStillExists = layerEntries.some((entry) => entry.item.id === activeInlineCurve.itemId)
    if (!itemStillExists || !expandedLayerIdSet.has(activeInlineCurve.itemId)) {
      setInlineCurve(null)
    }
  }, [activeInlineCurve, expandedLayerIdSet, layerEntries])

  const updateLayerTrack = useCallback(
    (trackId: string, updates: Partial<TimelineTrack>) => {
      const targetTrackIds = new Set([trackId])
      const item = items.find((candidate) => candidate.trackId === trackId)
      if (item) {
        const companion = getLinkedAudioCompanion(items, item)
        if (companion) targetTrackIds.add(companion.trackId)
      }
      setTracks(
        tracks.map((track) => (targetTrackIds.has(track.id) ? { ...track, ...updates } : track)),
      )
    },
    [items, tracks],
  )

  // Shift-clicking any row's lock icon applies that row's next state to every
  // row — layers and layer groups alike — so "lock everything except this one"
  // is two clicks. Groups are included so a header can't read unlocked while its
  // children are locked; a locked group disables its children's buttons, so the
  // group row is the way back out.
  const setAllTracksLocked = useCallback(
    (locked: boolean) => {
      setTracks(tracks.map((track) => (track.locked === locked ? track : { ...track, locked })))
    },
    [tracks],
  )

  const selectLayer = useCallback(
    (itemId: string, modifiers: { toggle?: boolean; range?: boolean } = {}) => {
      if (modifiers.range) {
        const anchorId = selectionAnchorIdRef.current ?? selectedItemIds.at(-1) ?? null
        const anchorIndex = anchorId ? visibleLayerIds.indexOf(anchorId) : -1
        const itemIndex = visibleLayerIds.indexOf(itemId)
        if (anchorIndex >= 0 && itemIndex >= 0) {
          const rangeStart = Math.min(anchorIndex, itemIndex)
          const rangeEnd = Math.max(anchorIndex, itemIndex)
          selectItems(
            Array.from(
              new Set([...selectedItemIds, ...visibleLayerIds.slice(rangeStart, rangeEnd + 1)]),
            ),
          )
          return
        }
      }

      selectionAnchorIdRef.current = itemId
      if (!modifiers.toggle) {
        selectItems([itemId])
        return
      }
      selectItems(
        selectedItemIdSet.has(itemId)
          ? selectedItemIds.filter((id) => id !== itemId)
          : [...selectedItemIds, itemId],
      )
    },
    [selectItems, selectedItemIdSet, selectedItemIds, visibleLayerIds],
  )

  const prepareLayerContextMenu = useCallback(
    (itemId: string) => {
      if (selectedItemIdSet.has(itemId)) return
      selectionAnchorIdRef.current = itemId
      selectItems([itemId])
    },
    [selectItems, selectedItemIdSet],
  )

  const prepareGroupContextMenu = useCallback(
    (itemIds: string[]) => {
      if (itemIds.length > 0 && itemIds.every((itemId) => selectedItemIdSet.has(itemId))) return
      selectItems(itemIds)
    },
    [selectItems, selectedItemIdSet],
  )

  const createGroupFromSelection = useCallback(() => {
    const selectedTrackIds = Array.from(
      new Set(
        layerEntries
          .filter((entry) => selectedItemIdSet.has(entry.item.id))
          .map((entry) => entry.track?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    )
    if (selectedTrackIds.length < 2) return
    const selectedTracks = tracks.filter((track) => selectedTrackIds.includes(track.id))
    const groupId = crypto.randomUUID()
    const groupNumber = tracks.filter((track) => track.isGroup).length + 1
    const group: TimelineTrack = {
      id: groupId,
      name: t('editor.compose.groupName', { count: groupNumber }),
      kind: 'video',
      height: LAYER_ROW_HEIGHT,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      order: Math.min(...selectedTracks.map((track) => track.order)),
      items: [],
      isGroup: true,
      isCollapsed: false,
    }
    setTracks([
      ...tracks.map((track) =>
        selectedTrackIds.includes(track.id) ? { ...track, parentTrackId: groupId } : track,
      ),
      group,
    ])
  }, [layerEntries, selectedItemIdSet, t, tracks])

  const ungroupTracks = useCallback(
    (groupId: string) => {
      setTracks(
        tracks
          .filter((track) => track.id !== groupId)
          .map((track) =>
            track.parentTrackId === groupId ? { ...track, parentTrackId: undefined } : track,
          ),
      )
    },
    [tracks],
  )

  const beginRename = useCallback((target: RenameTarget, name: string) => {
    setRenameTarget(target)
    setRenameDraft(name)
  }, [])

  const commitRename = useCallback(() => {
    if (!renameTarget) return
    const name = renameDraft.trim()
    if (name) {
      if (renameTarget.kind === 'layer') {
        updateItem(renameTarget.id, { label: name })
        const item = items.find((candidate) => candidate.id === renameTarget.id)
        if (item) updateLayerTrack(item.trackId, { name })
      } else {
        updateLayerTrack(renameTarget.id, { name })
      }
    }
    setRenameTarget(null)
    setRenameDraft('')
  }, [items, renameDraft, renameTarget, updateLayerTrack])

  const copyLayers = useCallback(
    (itemIds: string[]) => {
      const itemIdSet = new Set(expandMotionLayerItemIds(itemIds))
      const copiedItems = items.filter((item) => itemIdSet.has(item.id))
      if (copiedItems.length === 0) return
      useClipboardStore
        .getState()
        .copyItems(copiedItems, usePlaybackStore.getState().currentFrame, 'copy')
      toast.success(itemIds.length === 1 ? 'Copied layer' : `Copied ${itemIds.length} layers`)
    },
    [expandMotionLayerItemIds, items],
  )

  const duplicateLayers = useCallback(
    (itemIds: string[], sourceGroup?: TimelineTrack) => {
      const expandedItemIds = expandMotionLayerItemIds(itemIds)
      const sourceItems = expandedItemIds
        .map((itemId) => items.find((item) => item.id === itemId))
        .filter((item): item is TimelineItem => Boolean(item))
      if (sourceItems.length === 0) return

      const maxOrder = Math.max(-1, ...tracks.map((track) => track.order))
      const duplicatedGroupId = sourceGroup ? crypto.randomUUID() : null
      const newTracks: TimelineTrack[] = []
      if (sourceGroup && duplicatedGroupId) {
        newTracks.push({
          ...sourceGroup,
          id: duplicatedGroupId,
          name: `${sourceGroup.name} copy`,
          order: maxOrder + 1,
          items: [],
          isCollapsed: false,
        })
      }

      const positions = sourceItems.map((item, index) => {
        const sourceTrack = trackById.get(item.trackId)
        const newTrackId = crypto.randomUUID()
        newTracks.push({
          ...(sourceTrack ?? {
            name: item.label || item.type,
            kind: item.type === 'audio' ? 'audio' : 'video',
            height: LAYER_ROW_HEIGHT,
            locked: false,
            syncLock: true,
            visible: true,
            muted: false,
            solo: false,
            items: [],
          }),
          id: newTrackId,
          name: `${item.label ?? sourceTrack?.name ?? item.type} copy`,
          order: maxOrder + newTracks.length + index + 1,
          parentTrackId: duplicatedGroupId ?? sourceTrack?.parentTrackId,
          isGroup: false,
          items: [],
        } as TimelineTrack)
        return { from: item.from, trackId: newTrackId }
      })

      const duplicatedItems = duplicateItemsWithTrackChanges(
        [...tracks, ...newTracks],
        sourceItems.map((item) => item.id),
        positions,
      )
      const duplicatedHiddenAudioIds = new Set(
        duplicatedItems.flatMap((item) => {
          const companion = getLinkedAudioCompanion(duplicatedItems, item)
          return companion ? [companion.id] : []
        }),
      )
      selectItems(
        duplicatedItems
          .filter((item) => !duplicatedHiddenAudioIds.has(item.id))
          .map((item) => item.id),
      )
    },
    [expandMotionLayerItemIds, items, selectItems, trackById, tracks],
  )

  const pasteLayers = useCallback(
    (parentTrackId?: string) => {
      const clipboard = useClipboardStore.getState().itemsClipboard
      if (!clipboard || clipboard.items.length === 0) return

      const pasteFrame = usePlaybackStore.getState().currentFrame
      const maxOrder = Math.max(-1, ...tracks.map((track) => track.order))
      const pastedLinkedGroupIds = createPastedLinkedGroupIds(clipboard.items)
      const pastedLayers = clipboard.items.flatMap((item, index) => {
        const pasted = createPastedLayer({
          item,
          index,
          pasteFrame,
          maxOrder,
          parentTrackId,
          activeCompositionId,
          compositionById,
          trackById,
          linkedGroupIds: pastedLinkedGroupIds,
        })
        return pasted ? [pasted] : []
      })
      const newTracks = pastedLayers.map((layer) => layer.track)
      const newItems = pastedLayers.map((layer) => layer.item)
      if (newItems.length === 0) return
      addItemsOnNewTracks(newItems, [...tracks, ...newTracks])
      const visiblePastedItems = getVisibleLinkedItems(newItems)
      selectItems(visiblePastedItems.map((item) => item.id))
      toast.success(
        visiblePastedItems.length === 1
          ? 'Pasted layer'
          : `Pasted ${visiblePastedItems.length} layers`,
      )
    },
    [activeCompositionId, compositionById, selectItems, trackById, tracks],
  )

  const deleteLayers = useCallback(
    (itemIds: string[], trackIds: string[]) => {
      const expandedItemIds = expandMotionLayerItemIds(itemIds)
      removeItems(expandedItemIds)
      const expandedItemIdSet = new Set(expandedItemIds)
      const removedTrackIds = new Set([
        ...trackIds,
        ...items.filter((item) => expandedItemIdSet.has(item.id)).map((item) => item.trackId),
      ])
      setTracks(tracks.filter((track) => !removedTrackIds.has(track.id)))
      selectItems([])
    },
    [expandMotionLayerItemIds, items, selectItems, tracks],
  )

  const beginSpanDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, itemIds: string[]) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const lane = event.currentTarget.parentElement
      const laneWidth = lane?.getBoundingClientRect().width ?? 0
      if (laneWidth <= 0) return
      const itemIdSet = new Set(expandMotionLayerItemIds(itemIds))
      const dragItems = items
        .filter((item) => itemIdSet.has(item.id))
        .map((item) => ({
          id: item.id,
          from: item.from,
          durationInFrames: item.durationInFrames,
        }))
      if (dragItems.length === 0) return
      pause()
      if (itemIds.length === 1) {
        selectLayer(itemIds[0]!, {
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      } else {
        selectItems(itemIds)
      }
      const next: SpanDragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        laneWidth,
        deltaFrames: 0,
        items: dragItems,
      }
      const itemIdSetForVisuals = new Set(itemIds)
      const visuals = new Set<HTMLElement>([event.currentTarget])
      for (const row of motionScrollAreaRef.current?.querySelectorAll<HTMLElement>(
        '[data-motion-layer-item-id]',
      ) ?? []) {
        if (!itemIdSetForVisuals.has(row.dataset.motionLayerItemId ?? '')) continue
        for (const visual of row.querySelectorAll<HTMLElement>('[data-motion-span-drag-visual]')) {
          visuals.add(visual)
        }
      }
      spanDragVisualsRef.current = [...visuals]
      for (const visual of spanDragVisualsRef.current) visual.style.willChange = 'transform'
      spanDragRef.current = next
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [expandMotionLayerItemIds, items, pause, selectItems, selectLayer],
  )

  const moveSpanDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = spanDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const rawDelta = Math.round(
        ((event.clientX - drag.startX) / drag.laneWidth) * visibleFrameRange,
      )
      const minDelta = -Math.min(...drag.items.map((item) => item.from))
      const maxDelta = Math.min(...drag.items.map((item) => durationInFrames - item.from - 1))
      const deltaFrames = Math.max(minDelta, Math.min(maxDelta, rawDelta))
      if (deltaFrames === drag.deltaFrames) return
      const next = { ...drag, deltaFrames }
      spanDragRef.current = next
      if (spanDragAnimationFrameRef.current !== null) return
      spanDragAnimationFrameRef.current = requestAnimationFrame(() => {
        spanDragAnimationFrameRef.current = null
        const latestDrag = spanDragRef.current
        if (!latestDrag) return
        setSpanDragVisualOffset(
          spanDragVisualsRef.current,
          (latestDrag.deltaFrames / visibleFrameRange) * latestDrag.laneWidth,
        )
      })
    },
    [durationInFrames, visibleFrameRange],
  )

  const endSpanDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = spanDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (spanDragAnimationFrameRef.current !== null) {
      cancelAnimationFrame(spanDragAnimationFrameRef.current)
      spanDragAnimationFrameRef.current = null
    }
    clearSpanDragVisuals(spanDragVisualsRef.current)
    spanDragVisualsRef.current = []
    spanDragRef.current = null
    if (drag.deltaFrames !== 0) {
      moveItems(drag.items.map((item) => ({ id: item.id, from: item.from + drag.deltaFrames })))
    }
  }, [])

  const cancelSpanDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = spanDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (spanDragAnimationFrameRef.current !== null) {
      cancelAnimationFrame(spanDragAnimationFrameRef.current)
      spanDragAnimationFrameRef.current = null
    }
    clearSpanDragVisuals(spanDragVisualsRef.current)
    spanDragVisualsRef.current = []
    spanDragRef.current = null
  }, [])

  const beginSpanTrim = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, item: TimelineItem, handle: 'start' | 'end') => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const lane = event.currentTarget.closest<HTMLElement>('[data-motion-timeline-lane]')
      const laneWidth = lane?.getBoundingClientRect().width ?? 0
      const segment = event.currentTarget.closest<HTMLButtonElement>(
        '[data-testid^="motion-layer-span-"]',
      )
      if (laneWidth <= 0 || !segment) return
      const row = segment.closest<HTMLElement>('[data-motion-layer-item-id]')
      const timelineVisuals = Array.from(
        row?.querySelectorAll<HTMLElement>('[data-motion-span-drag-visual]') ?? [],
      ).filter((visual) => visual !== segment)
      const segmentRect = segment.getBoundingClientRect()
      pause()
      selectItems([item.id])
      const next: SpanTrimState = {
        pointerId: event.pointerId,
        itemId: item.id,
        handle,
        startX: event.clientX,
        laneWidth,
        deltaFrames: 0,
        from: item.from,
        durationInFrames: item.durationInFrames,
        segment,
        segmentWidthPx: segmentRect.width,
        segmentInlineWidth: segment.style.width,
        segmentInlineTransform: segment.style.transform,
        segmentInlineWillChange: segment.style.willChange,
        timelineVisuals,
      }
      segment.style.willChange = 'transform, width'
      if (handle === 'start') {
        for (const visual of timelineVisuals) visual.style.willChange = 'transform'
      }
      spanTrimRef.current = next
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [pause, selectItems],
  )

  const moveSpanTrim = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const trim = spanTrimRef.current
      if (!trim || trim.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const rawDelta = Math.round(
        ((event.clientX - trim.startX) / trim.laneWidth) * visibleFrameRange,
      )
      const minDelta = trim.handle === 'start' ? -trim.from : -(trim.durationInFrames - 1)
      const maxDelta =
        trim.handle === 'start'
          ? trim.durationInFrames - 1
          : durationInFrames - (trim.from + trim.durationInFrames)
      const deltaFrames = Math.max(minDelta, Math.min(maxDelta, rawDelta))
      if (deltaFrames === trim.deltaFrames) return
      const next = { ...trim, deltaFrames }
      spanTrimRef.current = next
      if (spanTrimAnimationFrameRef.current !== null) return
      spanTrimAnimationFrameRef.current = requestAnimationFrame(() => {
        spanTrimAnimationFrameRef.current = null
        const latestTrim = spanTrimRef.current
        if (latestTrim) applySpanTrimVisuals(latestTrim, visibleFrameRange)
      })
    },
    [durationInFrames, visibleFrameRange],
  )

  const finishSpanTrim = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, commit: boolean) => {
      const trim = spanTrimRef.current
      if (!trim || trim.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (spanTrimAnimationFrameRef.current !== null) {
        cancelAnimationFrame(spanTrimAnimationFrameRef.current)
        spanTrimAnimationFrameRef.current = null
      }
      clearSpanTrimVisuals(trim)
      spanTrimRef.current = null
      if (!commit || trim.deltaFrames === 0) return
      if (trim.handle === 'start') {
        trimItemStart(trim.itemId, trim.deltaFrames, { forceLinked: true })
      } else {
        trimItemEnd(trim.itemId, trim.deltaFrames, { forceLinked: true })
      }
    },
    [],
  )

  const endSpanTrim = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => finishSpanTrim(event, true),
    [finishSpanTrim],
  )
  const cancelSpanTrim = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => finishSpanTrim(event, false),
    [finishSpanTrim],
  )

  const beginRowReorder = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, track: TimelineTrack) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const parentTrackId = track.parentTrackId ?? null
      const root = event.currentTarget.closest('[data-testid="compositing-timeline"]')
      const siblingRows = Array.from(
        root?.querySelectorAll<HTMLElement>('[data-motion-row-track-id]') ?? [],
      ).filter((row) => (row.dataset.motionParentTrackId || null) === parentTrackId)
      const siblingCenters = siblingRows.map((row) => {
        const rect = row.getBoundingClientRect()
        return {
          trackId: row.dataset.motionRowTrackId!,
          centerY: rect.top + rect.height / 2,
          row,
        }
      })
      const originIndex = siblingCenters.findIndex((candidate) => candidate.trackId === track.id)
      if (originIndex < 0) return
      const sourceRow = siblingCenters[originIndex]?.row
      if (!sourceRow) return
      const dropIndicator = document.createElement('div')
      dropIndicator.className = 'pointer-events-none absolute inset-x-0 z-40 h-0.5 bg-primary'
      sourceRow.style.willChange = 'transform'
      const next: RowReorderDragState = {
        pointerId: event.pointerId,
        sourceTrackId: track.id,
        parentTrackId,
        startY: event.clientY,
        deltaY: 0,
        originIndex,
        targetIndex: originIndex,
        sourceRow,
        dropCandidates: siblingCenters.filter((candidate) => candidate.trackId !== track.id),
        dropIndicator,
      }
      rowReorderDragRef.current = next
      setRowReorderDrag(next)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [],
  )

  const applyRowReorderPreview = useCallback((clientY: number) => {
    const drag = rowReorderDragRef.current
    if (!drag) return
    const targetIndex = drag.dropCandidates.reduce(
      (index, candidate) => index + (clientY > candidate.centerY ? 1 : 0),
      0,
    )
    const dropAfterTarget = targetIndex >= drag.dropCandidates.length
    const dropTarget = drag.dropCandidates[targetIndex] ?? drag.dropCandidates.at(-1) ?? null
    const next = {
      ...drag,
      deltaY: clientY - drag.startY,
      targetIndex,
    }
    rowReorderDragRef.current = next
    drag.sourceRow.style.transform = `translate3d(0, ${next.deltaY}px, 0)`
    if (dropTarget) {
      dropTarget.row.appendChild(drag.dropIndicator)
      drag.dropIndicator.style.top = dropAfterTarget ? '' : '0'
      drag.dropIndicator.style.bottom = dropAfterTarget ? '0' : ''
    } else {
      drag.dropIndicator.remove()
    }
  }, [])

  const moveRowReorder = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = rowReorderDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      pendingRowReorderClientYRef.current = event.clientY
      if (rowReorderAnimationFrameRef.current !== null) return
      rowReorderAnimationFrameRef.current = window.requestAnimationFrame(() => {
        rowReorderAnimationFrameRef.current = null
        const clientY = pendingRowReorderClientYRef.current
        pendingRowReorderClientYRef.current = null
        if (clientY !== null) applyRowReorderPreview(clientY)
      })
    },
    [applyRowReorderPreview],
  )

  const clearRowReorderPreview = useCallback((drag: RowReorderDragState) => {
    if (rowReorderAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(rowReorderAnimationFrameRef.current)
      rowReorderAnimationFrameRef.current = null
    }
    pendingRowReorderClientYRef.current = null
    drag.sourceRow.style.transform = ''
    drag.sourceRow.style.willChange = ''
    drag.dropIndicator.remove()
  }, [])

  const finishRowReorder = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const activeDrag = rowReorderDragRef.current
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      applyRowReorderPreview(event.clientY)
      const drag = rowReorderDragRef.current
      if (!drag) return
      clearRowReorderPreview(drag)
      rowReorderDragRef.current = null
      setRowReorderDrag(null)
      if (drag.targetIndex === drag.originIndex) return

      const latestTracks = useItemsStore.getState().tracks
      const siblings = latestTracks
        .filter((track) => (track.parentTrackId ?? null) === drag.parentTrackId)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      const sourceIndex = siblings.findIndex((track) => track.id === drag.sourceTrackId)
      if (sourceIndex < 0) return
      const [source] = siblings.splice(sourceIndex, 1)
      if (!source) return
      siblings.splice(Math.max(0, Math.min(drag.targetIndex, siblings.length)), 0, source)
      const orderByTrackId = new Map(siblings.map((track, index) => [track.id, index]))
      setTracks(
        latestTracks.map((track) => {
          const order = orderByTrackId.get(track.id)
          return order === undefined ? track : { ...track, order }
        }),
      )
    },
    [applyRowReorderPreview, clearRowReorderPreview],
  )

  const cancelRowReorder = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = rowReorderDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      clearRowReorderPreview(drag)
      rowReorderDragRef.current = null
      setRowReorderDrag(null)
    },
    [clearRowReorderPreview],
  )

  const isRowReordering = rowReorderDrag !== null
  useEffect(() => {
    if (!isRowReordering) return
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = previousCursor
    }
  }, [isRowReordering])

  useEffect(
    () => () => {
      const drag = rowReorderDragRef.current
      if (drag) clearRowReorderPreview(drag)
    },
    [clearRowReorderPreview],
  )

  const addGeneratedLayer = useCallback(
    (kind: GeneratedLayerKind) => {
      if (!composition || composition.editorKind !== 'composite-2d') return
      const trackId = crypto.randomUUID()
      const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
      const placement = {
        trackId,
        from: 0,
        durationInFrames,
        canvasWidth: composition.width,
        canvasHeight: composition.height,
        fps,
      }
      const item = createGeneratedLayerItem(kind, placement)
      const track: TimelineTrack = {
        id: trackId,
        name: item.label || 'Layer',
        kind: 'video',
        height: LAYER_ROW_HEIGHT,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        order,
        items: [],
      }
      addItemOnNewTrack(item, [...tracks, track])
      selectItems([item.id])
    },
    [composition, durationInFrames, fps, selectItems, tracks],
  )

  const insertCompositionLayer = useCallback(
    (compositionId: string, from: number) => {
      if (!activeCompositionId || !composition || composition.editorKind !== 'composite-2d') {
        return false
      }
      const latestItems = useItemsStore.getState().items
      const latestTracks = useItemsStore.getState().tracks
      const child = compositionById[compositionId]
      if (!child || child.id === activeCompositionId) return false
      const effectiveCompositionById = {
        ...compositionById,
        [activeCompositionId]: { ...composition, items: latestItems, tracks: latestTracks },
      }
      if (
        wouldCreateCompositionCycle({
          parentCompositionId: activeCompositionId,
          insertedCompositionId: child.id,
          compositionById: effectiveCompositionById,
        })
      ) {
        toast.error(t('editor.compose.compositionCycle'))
        return false
      }

      const trackId = crypto.randomUUID()
      const order = latestTracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
      const track = createLayerTrack({ id: trackId, name: child.name, kind: 'video', order })
      const [item] = buildDroppedCompositionTimelineItems({
        compositionId: child.id,
        composition: child,
        label: child.name,
        placements: [
          {
            trackId,
            from,
            durationInFrames: Math.max(
              1,
              Math.min(durationInFrames - from, child.durationInFrames),
            ),
            mediaType: 'video',
          },
        ],
      })
      if (!item || item.type !== 'composition') return false
      addItemOnNewTrack(item, [...latestTracks, track])
      selectItems([item.id])
      return true
    },
    [activeCompositionId, composition, compositionById, durationInFrames, selectItems, t],
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault()
      setDropActive(false)
      if (!composition || composition.editorKind !== 'composite-2d') return

      const raw = event.dataTransfer.getData('application/json')
      let payload: unknown = getMediaDragData()
      if (raw) {
        try {
          payload = JSON.parse(raw)
        } catch {
          payload = null
        }
      }
      clearMediaDragData()
      if (!payload || typeof payload !== 'object') return

      const dropFrame = Math.max(
        0,
        Math.min(
          (compositionEndFrame ?? durationInFrames) - 1,
          usePlaybackStore.getState().currentFrame,
        ),
      )
      const candidate = payload as { type?: unknown; compositionId?: unknown }
      if (candidate.type === 'composition' && typeof candidate.compositionId === 'string') {
        insertCompositionLayer(candidate.compositionId, dropFrame)
        return
      }

      const latestTracks = useItemsStore.getState().tracks
      const nextOrder = latestTracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
      if (isTimelineTemplateDragData(payload)) {
        const trackId = crypto.randomUUID()
        const track = createLayerTrack({
          id: trackId,
          name: payload.label,
          kind: 'video',
          order: nextOrder,
        })
        const item = createTimelineTemplateItem({
          template: payload,
          placement: {
            trackId,
            from: dropFrame,
            durationInFrames: Math.max(1, durationInFrames - dropFrame),
            canvasWidth: composition.width,
            canvasHeight: composition.height,
            fps,
          },
        })
        addItemOnNewTrack(item, [...latestTracks, track])
        selectItems([item.id])
        return
      }

      const entries = resolveDroppedMediaEntriesFromPayload(payload, mediaItems, logger)
      if (entries.length === 0) {
        toast.error(t('editor.compose.unsupportedDrop'))
        return
      }

      const resolved = await Promise.all(
        entries.map(async (entry, index) => {
          const blobUrl = await resolveMediaUrl(entry.mediaId)
          if (!blobUrl) return null
          const trackId = crypto.randomUUID()
          const track = createLayerTrack({
            id: trackId,
            name: entry.label,
            kind: entry.mediaType === 'audio' ? 'audio' : 'video',
            order: nextOrder + index,
          })
          const sourceDuration = getDroppedMediaDurationInFrames(entry.media, entry.mediaType, fps)
          const [item] = buildDroppedMediaTimelineItems({
            media: entry.media,
            mediaId: entry.mediaId,
            mediaType: entry.mediaType,
            label: entry.label,
            timelineFps: fps,
            blobUrl,
            thumbnailUrl: null,
            canvasWidth: composition.width,
            canvasHeight: composition.height,
            placement: {
              primary: {
                trackId,
                from: dropFrame,
                durationInFrames: Math.max(
                  1,
                  Math.min(durationInFrames - dropFrame, sourceDuration),
                ),
              },
            },
            linkVideoAudio: false,
          })
          return item ? { item, track } : null
        }),
      )
      const layers = resolved.filter(
        (entry): entry is { item: TimelineItem; track: TimelineTrack } => entry !== null,
      )
      if (layers.length === 0) {
        toast.error(t('editor.compose.mediaDropFailed'))
        return
      }

      addItemsOnNewTracks(
        layers.map((entry) => entry.item),
        [...latestTracks, ...layers.map((entry) => entry.track)],
      )
      selectItems(layers.map((entry) => entry.item.id))
    },
    [
      composition,
      compositionEndFrame,
      durationInFrames,
      fps,
      insertCompositionLayer,
      mediaItems,
      selectItems,
      t,
    ],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    const hasLayerPayload =
      getMediaDragData() !== null ||
      Array.from(event.dataTransfer.types).includes('application/json')
    if (!hasLayerPayload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    setDropActive(false)
  }, [])

  const frameFromClientX = useCallback(
    (clientX: number, surface: HTMLDivElement, viewport: MotionTimeViewport) => {
      const rect = surface.getBoundingClientRect()
      if (rect.width <= 0) return null
      const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
      return Math.max(
        0,
        Math.min(
          // The playhead stays inside the comp, After Effects style — the axis may
          // run past the comp end to show an overhanging layer, but there is no
          // frame out there to sit on.
          (compositionEndFrame ?? durationInFrames) - 1,
          Math.round(viewport.startFrame + ((clientX - rect.left) / rect.width) * frameRange),
        ),
      )
    },
    [compositionEndFrame, durationInFrames],
  )

  const runPlayheadScrubLoop = useCallback(
    (timestamp: number) => {
      scrubAnimationFrameRef.current = null
      const pointerId = playheadScrubPointerIdRef.current
      const clientX = playheadScrubClientXRef.current
      const surface = playheadScrubSurfaceRef.current
      let viewport = playheadScrubViewportRef.current
      if (pointerId === null || clientX === null || !surface || !viewport) return

      const rect = surface.getBoundingClientRect()
      const visibleRange = Math.max(1, viewport.endFrame - viewport.startFrame)
      const autoEdgeEndFrame = compositionEndFrame ?? durationInFrames
      const velocity =
        visibleRange < autoEdgeEndFrame ? getMotionPlayheadEdgeScrollVelocity(clientX, rect) : 0
      let keepScrolling = false
      if (velocity !== 0 && rect.width > 0) {
        const previousTimestamp = scrubAnimationTimeRef.current ?? timestamp - 1000 / 60
        const elapsedSeconds = Math.min(32, Math.max(0, timestamp - previousTimestamp)) / 1000
        scrubAnimationTimeRef.current = timestamp
        const pannedViewport = panMotionTimeViewport(
          viewport,
          velocity * elapsedSeconds,
          rect.width,
          autoEdgeEndFrame,
        )
        const boundaryVisibleRange =
          Math.abs(visibleRange - Math.round(visibleRange)) < 1e-9
            ? Math.round(visibleRange)
            : visibleRange
        // Preserve fractional motion inside the range, but canonicalize the
        // terminal edge. Floating-point residue at 0/comp-end otherwise leaves
        // the imperative preview a fraction away from the settled boundary.
        const nextViewport =
          velocity < 0 && pannedViewport.startFrame <= Number.EPSILON * autoEdgeEndFrame * 4
            ? { startFrame: 0, endFrame: boundaryVisibleRange }
            : velocity > 0 &&
                autoEdgeEndFrame - pannedViewport.endFrame <= Number.EPSILON * autoEdgeEndFrame * 4
              ? {
                  startFrame: Math.max(0, autoEdgeEndFrame - boundaryVisibleRange),
                  endFrame: autoEdgeEndFrame,
                }
              : pannedViewport
        if (
          nextViewport.startFrame !== viewport.startFrame ||
          nextViewport.endFrame !== viewport.endFrame
        ) {
          viewport = nextViewport
          playheadScrubViewportRef.current = nextViewport
          keepScrolling = true
        }
      } else {
        scrubAnimationTimeRef.current = null
      }

      const frame = frameFromClientX(clientX, surface, viewport)
      if (frame !== null && frame !== latestScrubFrameRef.current) {
        latestScrubFrameRef.current = frame
        setPreviewFrame(frame)
      }
      if (viewport !== timeViewportRef.current) {
        // Keep the drag visual locked to the pointer. The preview frame remains
        // integer-quantized, which otherwise produces a visible sawtooth while
        // the viewport itself advances by fractional frames.
        const playheadProgress = rect.width > 0 ? (clientX - rect.left) / rect.width : undefined
        previewMotionTimeViewport(viewport, playheadProgress)
      }

      if (keepScrolling) {
        scrubAnimationFrameRef.current = requestAnimationFrame(runPlayheadScrubLoop)
      }
    },
    [
      compositionEndFrame,
      durationInFrames,
      frameFromClientX,
      previewMotionTimeViewport,
      setPreviewFrame,
    ],
  )

  const handleMotionTimelineWheel = useCallback(
    (event: WheelEvent) => {
      const isZoomGesture = event.ctrlKey || event.metaKey
      const isVerticalScrollGesture = event.altKey && !isZoomGesture
      const panGesture = getMotionTimelinePanGesture(event, wheelMotionPanAxisRef.current)
      if (!isZoomGesture && !isVerticalScrollGesture && panGesture === null) return
      const scrollArea = motionScrollAreaRef.current
      if (!scrollArea) return
      const rect = scrollArea.getBoundingClientRect()
      const timelineLeft = rect.left + LAYER_COLUMN_WIDTH
      const isTimelinePane = event.clientX >= timelineLeft
      // The shared layer scroller must not receive ordinary wheel input from
      // either pane. Consume during capture before nested property editors or
      // native overflow scrolling can react to the same gesture.
      event.preventDefault()
      event.stopPropagation()

      if (isVerticalScrollGesture) {
        wheelMotionPanAxisRef.current = null
        // Motion reserves Alt/Option+wheel (or the scrollbar) for deliberate
        // vertical layer/property navigation while ordinary wheel owns time.
        scrollArea.scrollTop += event.deltaY || event.deltaX
        return
      }

      // Like Edit's non-scrollable track-header viewport, ordinary wheel over
      // the layer column is safely consumed without creating a second pan.
      if (!isTimelinePane) return

      const measuredTimelineWidth = scrollArea.clientWidth - LAYER_COLUMN_WIDTH
      const timelineWidth = Math.max(
        1,
        measuredTimelineWidth > 0 ? measuredTimelineWidth : rect.right - timelineLeft,
      )
      if (panGesture !== null) {
        wheelMotionPanAxisRef.current = panGesture.axis
        // Match Edit's timeline navigation ownership: a mouse wheel's deltaY
        // and a trackpad's dominant deltaX both move only along the time axis.
        // Lock that physical axis for the gesture so cross-axis noise cannot
        // make the navigator thumb oscillate between deltas.
        queueMotionViewportUpdate((current) =>
          panMotionTimeViewport(current, panGesture.delta, timelineWidth, durationInFrames),
        )
        return
      }

      wheelMotionPanAxisRef.current = null
      if (event.deltaY === 0) return
      const pivotRatio = Math.max(0, Math.min(1, (event.clientX - timelineLeft) / timelineWidth))
      const zoomFactor = event.deltaY > 0 ? 1.25 : 0.8
      const minVisibleFrames = Math.min(
        durationInFrames,
        Math.max(
          1,
          Math.ceil(
            Math.max(1, timelineWidth - KEYFRAME_EDGE_INSET * 2) /
              KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
          ),
        ),
      )
      queueMotionViewportUpdate((current) =>
        zoomMotionTimeViewport(current, pivotRatio, zoomFactor, durationInFrames, minVisibleFrames),
      )
    },
    [durationInFrames, queueMotionViewportUpdate],
  )

  useEffect(() => {
    const navigationRoot = motionViewportPreviewRootRef.current
    if (!navigationRoot) return
    navigationRoot.addEventListener('wheel', handleMotionTimelineWheel, {
      capture: true,
      passive: false,
    })
    return () => {
      navigationRoot.removeEventListener('wheel', handleMotionTimelineWheel, { capture: true })
    }
  }, [handleMotionTimelineWheel])

  useEffect(() => {
    const scrollArea = motionScrollAreaRef.current
    if (!scrollArea) return

    const finishMiddlePan = () => {
      if (!middlePanRef.current) return
      middlePanRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const beginMiddlePan = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (middlePanRef.current) return
      middlePanRef.current = {
        startClientY: event.clientY,
        startScrollTop: scrollArea.scrollTop,
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const moveMiddlePan = (event: MouseEvent | PointerEvent) => {
      const pan = middlePanRef.current
      if (!pan) return
      event.preventDefault()
      event.stopPropagation()
      scrollArea.scrollTop = pan.startScrollTop + (event.clientY - pan.startClientY)
    }

    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
    }

    scrollArea.addEventListener('pointerdown', beginMiddlePan, { capture: true })
    scrollArea.addEventListener('mousedown', beginMiddlePan, { capture: true })
    scrollArea.addEventListener('auxclick', preventMiddleAuxClick, { capture: true })
    window.addEventListener('pointermove', moveMiddlePan, { capture: true })
    window.addEventListener('mousemove', moveMiddlePan, { capture: true })
    window.addEventListener('pointerup', finishMiddlePan, { capture: true })
    window.addEventListener('pointercancel', finishMiddlePan, { capture: true })
    window.addEventListener('mouseup', finishMiddlePan, { capture: true })
    return () => {
      finishMiddlePan()
      scrollArea.removeEventListener('pointerdown', beginMiddlePan, { capture: true })
      scrollArea.removeEventListener('mousedown', beginMiddlePan, { capture: true })
      scrollArea.removeEventListener('auxclick', preventMiddleAuxClick, { capture: true })
      window.removeEventListener('pointermove', moveMiddlePan, { capture: true })
      window.removeEventListener('mousemove', moveMiddlePan, { capture: true })
      window.removeEventListener('pointerup', finishMiddlePan, { capture: true })
      window.removeEventListener('pointercancel', finishMiddlePan, { capture: true })
      window.removeEventListener('mouseup', finishMiddlePan, { capture: true })
    }
  }, [])

  const beginPlayheadScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      playheadScrubPointerIdRef.current = event.pointerId
      playheadScrubClientXRef.current = event.clientX
      playheadScrubSurfaceRef.current = event.currentTarget
      playheadScrubViewportRef.current = timeViewportRef.current
      scrubAnimationTimeRef.current = null
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pause()
      const frame = frameFromClientX(event.clientX, event.currentTarget, timeViewportRef.current)
      if (frame !== null) {
        latestScrubFrameRef.current = frame
        setPreviewFrame(frame)
      }
      if (scrubAnimationFrameRef.current === null) {
        scrubAnimationFrameRef.current = requestAnimationFrame(runPlayheadScrubLoop)
      }
    },
    [frameFromClientX, pause, runPlayheadScrubLoop, setPreviewFrame],
  )

  const movePlayheadScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (playheadScrubPointerIdRef.current !== event.pointerId) return
      playheadScrubClientXRef.current = event.clientX
      if (scrubAnimationFrameRef.current !== null) return
      scrubAnimationFrameRef.current = requestAnimationFrame(runPlayheadScrubLoop)
    },
    [runPlayheadScrubLoop],
  )

  const endPlayheadScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (playheadScrubPointerIdRef.current !== event.pointerId) return
      playheadScrubPointerIdRef.current = null
      if (scrubAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scrubAnimationFrameRef.current)
        scrubAnimationFrameRef.current = null
      }
      const surface = playheadScrubSurfaceRef.current
      const finalViewport = playheadScrubViewportRef.current ?? timeViewportRef.current
      const pointerFrame =
        surface && event.type !== 'pointercancel'
          ? frameFromClientX(event.clientX, surface, finalViewport)
          : null
      const finalFrame = pointerFrame ?? latestScrubFrameRef.current
      latestScrubFrameRef.current = null
      scrubAnimationTimeRef.current = null
      playheadScrubClientXRef.current = null
      playheadScrubSurfaceRef.current = null
      playheadScrubViewportRef.current = null
      if (finalFrame !== null) setScrubFrame(finalFrame)
      setPreviewFrame(null)
      if (
        finalViewport.startFrame !== timeViewportRef.current.startFrame ||
        finalViewport.endFrame !== timeViewportRef.current.endFrame
      ) {
        commitMotionTimeViewport(finalViewport)
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
    },
    [commitMotionTimeViewport, frameFromClientX, setPreviewFrame, setScrubFrame],
  )

  useEffect(
    () => () => {
      if (scrubAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scrubAnimationFrameRef.current)
      }
      scrubAnimationTimeRef.current = null
      playheadScrubClientXRef.current = null
      playheadScrubSurfaceRef.current = null
      playheadScrubViewportRef.current = null
      setPreviewFrame(null)
    },
    [setPreviewFrame],
  )

  if (!isComposite || !composition || !activeCompositionId) {
    return (
      <>
        <section
          className={cn(
            'flex min-h-0 flex-1 flex-col border-t border-border bg-timeline-bg transition-shadow',
            dropActive && 'ring-1 ring-inset ring-primary/60',
            className,
          )}
          data-testid="compositing-timeline-empty"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel-header px-3 text-xs font-semibold text-muted-foreground">
            <Spline className="h-3.5 w-3.5 text-primary" />
            <span className="min-w-0 flex-1">{t('editor.compose.layerTimeline')}</span>
            <button
              type="button"
              onClick={() => setCreateDialogOpen(true)}
              className="flex h-6 items-center gap-1 rounded bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20"
            >
              <Plus className="h-3 w-3" />
              {t('editor.compose.newComposition')}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-[linear-gradient(to_right,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:10%_100%]">
            <div className="max-w-sm text-center">
              <p className="text-xs font-medium text-foreground">
                {t('editor.compose.chooseTitle')}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                {t('editor.compose.chooseDescription')}
              </p>
            </div>
          </div>
        </section>
        <NewCompositionDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          defaults={dialogDefaults}
        />
      </>
    )
  }

  const renderGroupRow = (row: Extract<MotionRow, { kind: 'group' }>) => {
    const groupSelected =
      row.items.length > 0 && row.items.every((item) => selectedItemIdSet.has(item.id))
    const groupFrom = row.items.length ? Math.min(...row.items.map((item) => item.from)) : 0
    const groupEnd = row.items.length
      ? Math.max(...row.items.map((item) => item.from + item.durationInFrames))
      : 0
    const groupItemIds = row.items.map((item) => item.id)
    const groupTrackIds = tracks
      .filter((track) => track.parentTrackId === row.track.id)
      .map((track) => track.id)
    const isDragging = rowReorderDrag?.sourceTrackId === row.track.id

    return (
      <div
        key={row.track.id}
        data-motion-row-track-id={row.track.id}
        data-motion-parent-track-id=""
        className={cn(
          'relative border-b border-border/70',
          isDragging && 'z-30 opacity-85 shadow-lg',
        )}
      >
        <MotionRowContextMenu
          canPaste={canPasteLayers}
          onOpen={() => prepareGroupContextMenu(groupItemIds)}
          onRename={() => beginRename({ kind: 'group', id: row.track.id }, row.track.name)}
          onUngroup={() => ungroupTracks(row.track.id)}
          onDuplicate={() => duplicateLayers(groupItemIds, row.track)}
          onCopy={() => copyLayers(groupItemIds)}
          onPaste={() => pasteLayers(row.track.id)}
          onDelete={() => deleteLayers(groupItemIds, [row.track.id, ...groupTrackIds])}
          deleteLabel={t('editor.compose.deleteLayerGroupAndContents')}
        >
          <div
            className={cn(
              'flex bg-panel-header/65 transition-colors',
              groupSelected && 'bg-accent/70',
            )}
            style={{ height: LAYER_ROW_HEIGHT }}
            data-testid={`motion-group-${row.track.id}`}
          >
            <div
              className="flex shrink-0 items-center gap-1 border-r border-border px-1.5"
              style={{ width: LAYER_COLUMN_WIDTH }}
            >
              <button
                type="button"
                data-testid={`motion-reorder-handle-${row.track.id}`}
                onPointerDown={(event) => beginRowReorder(event, row.track)}
                onPointerMove={moveRowReorder}
                onPointerUp={finishRowReorder}
                onPointerCancel={cancelRowReorder}
                className="flex h-6 w-3.5 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/65 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary active:text-primary"
                title={t('editor.compose.reorderGroup')}
                aria-label={t('editor.compose.reorderGroup')}
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  updateLayerTrack(row.track.id, { isCollapsed: !row.track.isCollapsed })
                }
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={
                  row.track.isCollapsed
                    ? t('editor.compose.expandGroup')
                    : t('editor.compose.collapseGroup')
                }
              >
                {row.track.isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => updateLayerTrack(row.track.id, { visible: !row.track.visible })}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={
                  row.track.visible === false
                    ? t('editor.compose.showGroup')
                    : t('editor.compose.hideGroup')
                }
              >
                {row.track.visible === false ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  if (event.shiftKey) {
                    setAllTracksLocked(!row.track.locked)
                    return
                  }
                  updateLayerTrack(row.track.id, { locked: !row.track.locked })
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={
                  row.track.locked ? t('editor.compose.unlockGroup') : t('editor.compose.lockGroup')
                }
                title={`${
                  row.track.locked ? t('editor.compose.unlockGroup') : t('editor.compose.lockGroup')
                } — ${t('editor.compose.lockAllLayersHint')}`}
              >
                {row.track.locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => updateLayerTrack(row.track.id, { solo: !row.track.solo })}
                className={cn(
                  'h-5 w-5 rounded text-[9px] font-bold',
                  row.track.solo
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                aria-label={
                  row.track.solo ? t('editor.compose.disableSolo') : t('editor.compose.soloGroup')
                }
              >
                S
              </button>
              {renameTarget?.kind === 'group' && renameTarget.id === row.track.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setRenameTarget(null)
                  }}
                  aria-label={t('editor.compose.layerGroupName')}
                  className="h-5 min-w-24 flex-1 rounded border border-primary/50 bg-background px-1.5 text-[11px] font-semibold outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => selectItems(groupItemIds)}
                  onDoubleClick={() =>
                    beginRename({ kind: 'group', id: row.track.id }, row.track.name)
                  }
                  className="min-w-0 flex-1 truncate px-1 text-left text-[11px] font-semibold text-foreground"
                  title={row.track.name}
                >
                  {row.track.name}
                  <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                    {t('editor.compose.groupLayerCount', { count: row.items.length })}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => ungroupTracks(row.track.id)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t('editor.compose.ungroup')}
                aria-label={t('editor.compose.ungroup')}
              >
                <Ungroup className="h-3.5 w-3.5" />
              </button>
            </div>
            <div
              className="relative min-w-0 flex-1 touch-none overflow-hidden"
              onPointerDown={beginPlayheadScrub}
              onPointerMove={movePlayheadScrub}
              onPointerUp={endPlayheadScrub}
              onPointerCancel={endPlayheadScrub}
            >
              <div data-motion-viewport-surface className="absolute inset-0 overflow-hidden">
                {Array.from({ length: RULER_DIVISIONS + 1 }, (_, tick) => (
                  <div
                    key={tick}
                    data-motion-static-x
                    className="pointer-events-none absolute inset-y-0 border-l border-border/45"
                    style={{ left: `${(tick / RULER_DIVISIONS) * 100}%` }}
                  />
                ))}
                {!activeInlineCurve && row.items.length > 0 && (
                  <button
                    type="button"
                    data-testid={`motion-group-span-${row.track.id}`}
                    data-from-frame={groupFrom}
                    data-to-frame={groupEnd}
                    disabled={row.track.locked}
                    onPointerDown={(event) =>
                      !row.track.locked && beginSpanDrag(event, groupItemIds)
                    }
                    onPointerMove={moveSpanDrag}
                    onPointerUp={endSpanDrag}
                    onPointerCancel={cancelSpanDrag}
                    className={cn(
                      'absolute top-1/2 h-6 -translate-y-1/2 touch-none rounded-sm border border-timeline-motion-segment/80 bg-timeline-motion-segment/70 px-1 text-left text-[9px] text-foreground',
                      row.track.locked
                        ? 'cursor-not-allowed opacity-55'
                        : 'cursor-grab active:cursor-grabbing',
                    )}
                    style={{
                      left: `${frameToMotionPercent(groupFrom)}%`,
                      width: `${Math.max(0.6, ((groupEnd - groupFrom) / visibleFrameRange) * 100)}%`,
                    }}
                  >
                    <span className="block truncate">{row.track.name}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </MotionRowContextMenu>
      </div>
    )
  }

  const layerSheet = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-timeline-bg">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-panel-header px-2">
        <Select
          value={composition.id}
          onValueChange={(value) => {
            const next = compositionById[value]
            if (next) openComposition(next.id, next.name)
          }}
        >
          <SelectTrigger
            aria-label={t('editor.compose.compositionPicker')}
            className="h-6 min-w-0 max-w-52 gap-1.5 bg-background px-2 text-[10px] font-semibold text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {compositeCompositions.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id} className="text-[10px]">
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setCreateDialogOpen(true)}
          className="flex h-6 shrink-0 items-center gap-1 rounded border border-border/70 bg-background px-2 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('editor.compose.newComposition')}
          aria-label={t('editor.compose.newComposition')}
        >
          <CopyPlus className="h-3 w-3" />
          {t('editor.compose.newCompositionShort')}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-6 shrink-0 items-center gap-1 rounded border border-border/70 bg-background px-2 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('editor.compose.addItem')}
            >
              <Plus className="h-3 w-3" />
              {t('editor.compose.addItem')}
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36">
            <DropdownMenuItem onSelect={() => addGeneratedLayer('text')}>
              <Type className="mr-2 h-3.5 w-3.5" />
              {t('editor.compose.textLayer')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGeneratedLayer('solid')}>
              <Square className="mr-2 h-3.5 w-3.5 fill-current" />
              {t('editor.compose.solidColorLayer')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGeneratedLayer('gradient')}>
              <Blend className="mr-2 h-3.5 w-3.5" />
              {t('editor.compose.gradientLayer')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGeneratedLayer('shape')}>
              <Square className="mr-2 h-3.5 w-3.5" />
              {t('editor.compose.shapeLayer')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGeneratedLayer('controller')}>
              <Crosshair className="mr-2 h-3.5 w-3.5" />
              {t('editor.compose.controllerLayer', { defaultValue: 'Null Object' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={createGroupFromSelection}
          disabled={!canGroupSelectedLayers}
          className="flex h-6 shrink-0 items-center gap-1 rounded border border-border/70 bg-background px-2 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          aria-label={t('editor.compose.groupSelected')}
          aria-description={t('editor.compose.layerGroupDescription')}
          title={t('editor.compose.layerGroupDescription')}
        >
          <Group className="h-3 w-3" />
          {t('editor.compose.group')}
        </button>
        <span className="flex-1" aria-hidden="true" />
        <span
          className="text-[10px] tabular-nums text-muted-foreground"
          data-testid="motion-composition-duration"
        >
          {compositionEndFrame ?? durationInFrames}f · {fps}fps
        </span>
        <button
          type="button"
          onClick={trimAndFitMotionTimeViewport}
          disabled={!canTrimToActiveRegion}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          aria-label={t('editor.compose.trimToActiveRegion')}
          data-tooltip={t('editor.compose.trimToActiveRegionTooltip')}
        >
          <Crop className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={fitMotionTimeViewport}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t('timeline.header.zoomToFit')}
          data-tooltip={t('timeline.header.zoomToFitTooltip')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={motionViewportPreviewRootRef} className="relative min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-0 z-30 overflow-visible"
          data-testid="motion-playhead-overlay"
        >
          <div
            data-motion-viewport-surface
            className="absolute inset-y-0 right-0 overflow-visible"
            style={{
              left: TIMELINE_CONTENT_LEFT + KEYFRAME_EDGE_INSET,
              right: KEYFRAME_EDGE_INSET + motionScrollbarWidth,
            }}
          >
            {/* Region shading covers the layer rows only — the ruler carries its
                own comp bar — and paints before the playhead so the playhead
                stays legible over a dimmed region. */}
            <div className="absolute inset-x-0 bottom-0" style={{ top: RULER_HEIGHT }}>
              <MotionActiveRegionOverlay
                viewport={timeViewport}
                compositionEndFrame={compositionEndFrame}
              />
            </div>
            <MotionPlayheadOverlay timeViewport={timeViewport} />
          </div>
        </div>
        <div
          ref={motionScrollAreaRef}
          data-testid="motion-layer-scroll-area"
          className="h-full overflow-x-hidden overflow-y-auto [content-visibility:auto]"
        >
          <div className="relative min-h-full w-full min-w-0">
            <div className="sticky top-0 z-20 flex border-b border-border bg-panel-header">
              <div
                className="flex shrink-0 border-r border-border text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                style={{
                  width: LAYER_COLUMN_WIDTH,
                  height: RULER_HEIGHT,
                }}
              >
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3">
                  <span>{t('editor.compose.layers')}</span>
                  <Select
                    value={propertyFilter}
                    onValueChange={(value) => setPropertyFilter(value as 'all' | 'keyframed')}
                  >
                    <SelectTrigger
                      aria-label="Property filter"
                      className="h-5 w-28 gap-1 bg-background px-2 text-[9px] font-normal normal-case tracking-normal text-muted-foreground"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-[10px]">
                        All properties
                      </SelectItem>
                      <SelectItem value="keyframed" className="text-[10px]">
                        Animated properties
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div
                  data-testid="motion-parent-header"
                  className="flex shrink-0 items-center border-l border-border px-2"
                  style={{ width: LAYER_PARENT_COLUMN_WIDTH }}
                >
                  {t('editor.compose.parentColumn', { defaultValue: 'Parent' })}
                </div>
                <div
                  data-testid="motion-timing-header"
                  className="flex shrink-0 items-center justify-around border-l border-border px-2"
                  style={{ width: LAYER_TIMING_COLUMN_WIDTH }}
                >
                  <span>{t('editor.compose.inColumn')}</span>
                  <span>{t('editor.compose.outColumn')}</span>
                </div>
                <div
                  className="flex shrink-0 items-center border-l border-border px-2"
                  style={{ width: LAYER_MODE_COLUMN_WIDTH }}
                >
                  {t('editor.compose.blendMode')}
                </div>
              </div>
              <div
                data-testid="motion-ruler-viewport"
                data-motion-viewport-surface
                className="relative min-w-0 flex-1 touch-none cursor-ew-resize overflow-x-clip overflow-y-visible"
                style={{ height: RULER_HEIGHT }}
              >
                <div
                  ref={motionRulerRef}
                  data-motion-viewport-surface
                  data-motion-ruler-surface
                  className="absolute inset-0"
                  onPointerDown={beginPlayheadScrub}
                  onPointerMove={movePlayheadScrub}
                  onPointerUp={endPlayheadScrub}
                  onPointerCancel={endPlayheadScrub}
                >
                  {Array.from({ length: RULER_DIVISIONS + 1 }, (_, index) => {
                    const frame = Math.round(
                      timeViewport.startFrame + (index / RULER_DIVISIONS) * visibleFrameRange,
                    )
                    return (
                      <div
                        key={index}
                        className="absolute inset-y-0 border-l border-border/70"
                        style={{ left: `${(index / RULER_DIVISIONS) * 100}%` }}
                      >
                        <span
                          data-motion-ruler-label-index={index}
                          className="ml-1 text-[9px] tabular-nums text-muted-foreground"
                        >
                          {formatFrameTime(frame, fps)}
                        </span>
                      </div>
                    )
                  })}
                  <MotionSelectionRetimeRange
                    range={motionSelectionTimeRange}
                    viewport={timeViewport}
                    durationInFrames={durationInFrames}
                    frameToPercent={frameToMotionPercent}
                    onBegin={beginSelectionRetime}
                    onMove={moveSelectionRetime}
                    onEnd={endSelectionRetime}
                    onCancel={cancelSelectionRetime}
                    onNudge={nudgeSelectionRetime}
                    rangeRef={motionSelectionRetimeRangeRef}
                  />
                </div>
                {compositionEndFrame !== null ? (
                  <MotionCompEndRulerDim
                    viewport={timeViewport}
                    compositionEndFrame={compositionEndFrame}
                  />
                ) : null}
                {/* Sibling of the scrub surface, not a child: the lane's own
                    background stays pointer-transparent so a click in the lane
                    still scrubs, while the strip and handles take their hits. */}
                <MotionIoLane
                  viewport={timeViewport}
                  maxFrame={compositionEndFrame ?? durationInFrames}
                  fps={fps}
                />
              </div>
            </div>

            {motionRows.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t('editor.compose.emptyLayers')}
              </div>
            ) : (
              motionRows.map((row, index) => {
                if (row.kind === 'group') return renderGroupRow(row)
                const { item, track, depth } = row
                const parentItemId = item.transformParent?.parentItemId
                const parentCandidates = layerEntries.flatMap((entry, layerIndex) => {
                  const candidate = entry.item
                  const isEligible =
                    candidate.id !== item.id &&
                    candidate.type !== 'audio' &&
                    candidate.type !== 'adjustment'
                  return isEligible ? [{ ...entry, layerNumber: layerIndex + 1 }] : []
                })
                const expanded = expandedLayerIdSet.has(item.id)
                const selected = selectedItemIdSet.has(item.id)
                const parentLayerGroup = track?.parentTrackId
                  ? trackById.get(track.parentTrackId)
                  : undefined
                const isParentLayerGroupLocked = parentLayerGroup?.locked === true
                const isLayerLocked = track?.locked === true || isParentLayerGroupLocked
                const nullObjectNonRenderingLabel =
                  item.type === 'controller'
                    ? t('editor.compose.nullObjectNonRendering', {
                        defaultValue: 'Null Object (does not render)',
                      })
                    : undefined
                const MotionLayerTypeIcon = getMotionLayerTypeIcon(item.type)
                const allProperties = getItemProperties(item)
                const isPathShape = item.type === 'shape' && item.shapeType === 'path'
                const showAllPathVertices = allPathVertexItemIds.has(item.id)
                const properties = getVisibleMotionPathProperties(allProperties, {
                  itemKeyframes: keyframesByItemId[item.id],
                  selectedVertexIndices:
                    maskEditingItemId === item.id ? selectedPathVertexIndices : [],
                  showAllVertices: showAllPathVertices,
                  alwaysInclude:
                    activeInlineCurve?.itemId === item.id ? activeInlineCurve.property : null,
                })
                const proceduralBands = getProceduralBands(
                  item.motionModifiers,
                  item.durationInFrames,
                  item.from,
                )
                const textMotionBands = getTextMotionTimelineBands(item)
                const hasProceduralMotion = proceduralBands.size > 0 || textMotionBands.length > 0
                const hasVisibleChildProperties =
                  propertyFilter === 'all' ||
                  textMotionBands.length > 0 ||
                  properties.some(
                    (property) =>
                      keyframesByItemId[item.id]?.properties.some(
                        (entry) => entry.property === property && entry.keyframes.length > 0,
                      ) || proceduralBands.has(property),
                  )
                const isDragging = rowReorderDrag?.sourceTrackId === track?.id
                return (
                  <div
                    key={item.id}
                    data-testid={`motion-layer-row-${item.id}`}
                    data-motion-layer-item-id={item.id}
                    data-motion-row-track-id={track?.id}
                    data-motion-parent-track-id={track?.parentTrackId ?? ''}
                    className={cn(
                      'relative border-b border-border/70',
                      isDragging && 'z-30 opacity-85 shadow-lg',
                      'data-[transform-parent-link-hover=true]:bg-orange-500/10 data-[transform-parent-link-hover=true]:ring-1 data-[transform-parent-link-hover=true]:ring-inset data-[transform-parent-link-hover=true]:ring-orange-400/70',
                      'data-[transform-parent-link-rejected=true]:bg-red-500/10 data-[transform-parent-link-rejected=true]:ring-1 data-[transform-parent-link-rejected=true]:ring-inset data-[transform-parent-link-rejected=true]:ring-red-400/70',
                    )}
                  >
                    <MotionRowContextMenu
                      canGroup={canGroupSelectedLayers}
                      canPaste={canPasteLayers}
                      onOpen={() => prepareLayerContextMenu(item.id)}
                      onRename={() =>
                        beginRename({ kind: 'layer', id: item.id }, item.label || item.type)
                      }
                      onGroup={createGroupFromSelection}
                      onDuplicate={() => duplicateLayers([item.id])}
                      onCopy={() => copyLayers([item.id])}
                      onPaste={() => pasteLayers(track?.parentTrackId)}
                      onDelete={() => deleteLayers([item.id], track ? [track.id] : [])}
                    >
                      <div
                        className={cn(
                          'flex transition-colors',
                          selected ? 'bg-accent/70' : 'hover:bg-accent/35',
                        )}
                        style={{ height: LAYER_ROW_HEIGHT }}
                      >
                        <div
                          className="flex shrink-0 border-r border-border"
                          style={{ width: LAYER_COLUMN_WIDTH }}
                        >
                          <div
                            data-testid={`motion-layer-name-cell-${item.id}`}
                            className="flex min-w-0 flex-1 items-center gap-1 px-1.5"
                            style={{ paddingLeft: 6 + depth * 16 }}
                          >
                            {track && (
                              <button
                                type="button"
                                data-testid={`motion-reorder-handle-${track.id}`}
                                disabled={isLayerLocked}
                                onPointerDown={(event) =>
                                  !isLayerLocked && beginRowReorder(event, track)
                                }
                                onPointerMove={moveRowReorder}
                                onPointerUp={finishRowReorder}
                                onPointerCancel={cancelRowReorder}
                                className="flex h-6 w-3.5 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/65 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary active:text-primary"
                                title={t('editor.compose.reorderLayer')}
                                aria-label={t('editor.compose.reorderLayer')}
                              >
                                <EllipsisVertical className="h-4 w-4" />
                              </button>
                            )}
                            {hasVisibleChildProperties ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  if (event.shiftKey) {
                                    setAllLayersExpanded(
                                      activeCompositionId,
                                      layerEntries.map((entry) => entry.item.id),
                                      !expanded,
                                    )
                                    return
                                  }
                                  toggleLayerExpanded(activeCompositionId, item.id)
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title={t('editor.compose.shiftToggleAllLayers', {
                                  defaultValue: 'Shift-click to expand or collapse all layers',
                                })}
                                aria-label={
                                  expanded
                                    ? t('editor.compose.collapseLayerProperties')
                                    : t('editor.compose.expandLayerProperties')
                                }
                              >
                                {expanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            )}
                            {item.type === 'controller' ? (
                              <span
                                className="h-[18px] w-[18px] shrink-0"
                                data-testid={`motion-null-object-icon-slot-${item.id}`}
                                aria-hidden="true"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  track && updateLayerTrack(track.id, { visible: !track.visible })
                                }
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label={
                                  track?.visible === false
                                    ? t('editor.compose.showLayer')
                                    : t('editor.compose.hideLayer')
                                }
                              >
                                {track?.visible === false ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(event) => {
                                if (!track || isParentLayerGroupLocked) return
                                if (event.shiftKey) {
                                  setAllTracksLocked(!track.locked)
                                  return
                                }
                                updateLayerTrack(track.id, { locked: !track.locked })
                              }}
                              disabled={isParentLayerGroupLocked}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
                              aria-label={
                                isParentLayerGroupLocked
                                  ? t('editor.compose.lockedByLayerGroup')
                                  : isLayerLocked
                                    ? t('editor.compose.unlockLayer')
                                    : t('editor.compose.lockLayer')
                              }
                              title={
                                isParentLayerGroupLocked
                                  ? t('editor.compose.lockedByLayerGroup')
                                  : `${
                                      isLayerLocked
                                        ? t('editor.compose.unlockLayer')
                                        : t('editor.compose.lockLayer')
                                    } — ${t('editor.compose.lockAllLayersHint')}`
                              }
                            >
                              {isLayerLocked ? (
                                <Lock className="h-3.5 w-3.5" />
                              ) : (
                                <Unlock className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {item.type === 'controller' ? (
                              <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  track && updateLayerTrack(track.id, { solo: !track.solo })
                                }
                                className={cn(
                                  'h-5 w-5 rounded text-[9px] font-bold',
                                  track?.solo
                                    ? 'bg-primary/15 text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                )}
                                aria-label={
                                  track?.solo
                                    ? t('editor.compose.disableSolo')
                                    : t('editor.compose.soloLayer')
                                }
                              >
                                S
                              </button>
                            )}
                            {renameTarget?.kind === 'layer' && renameTarget.id === item.id ? (
                              <input
                                autoFocus
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onFocus={(event) => event.currentTarget.select()}
                                onBlur={commitRename}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') event.currentTarget.blur()
                                  if (event.key === 'Escape') setRenameTarget(null)
                                }}
                                aria-label="Layer name"
                                className="h-5 min-w-24 flex-1 rounded border border-primary/50 bg-background px-1.5 text-[11px] font-medium outline-none"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={(event) =>
                                  selectLayer(item.id, {
                                    toggle: event.metaKey || event.ctrlKey,
                                    range: event.shiftKey,
                                  })
                                }
                                onDoubleClick={() =>
                                  beginRename(
                                    { kind: 'layer', id: item.id },
                                    item.label || item.type,
                                  )
                                }
                                className="min-w-0 flex-1 truncate px-0 text-left text-[11px] font-medium text-foreground"
                                title={nullObjectNonRenderingLabel ?? (item.label || item.type)}
                                aria-label={
                                  nullObjectNonRenderingLabel
                                    ? `${index + 1}. ${nullObjectNonRenderingLabel}`
                                    : undefined
                                }
                              >
                                <span className="mr-0.5 inline-block w-3 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground/70">
                                  {index + 1}
                                </span>
                                <MotionLayerTypeIcon
                                  className="mr-1 inline-block h-3 w-3 shrink-0 align-[-2px] text-muted-foreground"
                                  data-testid={`motion-layer-type-icon-${item.id}`}
                                  data-motion-layer-type-icon={item.type}
                                  aria-hidden="true"
                                />
                                {item.label || item.type}
                              </button>
                            )}
                          </div>
                          <div
                            data-testid={`motion-parent-cell-${item.id}`}
                            className="flex shrink-0 items-center gap-1 border-l border-border px-1"
                            style={{ width: LAYER_PARENT_COLUMN_WIDTH }}
                          >
                            <button
                              type="button"
                              data-testid={`motion-parent-pick-whip-${item.id}`}
                              disabled={isLayerLocked}
                              onPointerDown={(event) =>
                                !isLayerLocked &&
                                beginTransformParentDrag(event, item.id, parentItemId)
                              }
                              aria-label={t('editor.compose.parentPickWhipForLayer', {
                                defaultValue: 'Parent pick whip for {{name}}',
                                name: item.label || item.type,
                              })}
                              title={t('editor.compose.parentPickWhipHelp', {
                                defaultValue:
                                  'Drag to a parent layer. Shift: snap position. Alt: use local pose. Ctrl/Cmd-click: detach.',
                              })}
                              className={cn(
                                'flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-sm outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary',
                                parentItemId
                                  ? 'text-orange-400'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              <PickWhipIcon className="h-3.5 w-3.5" />
                            </button>
                            <Select
                              disabled={isLayerLocked}
                              value={parentItemId ?? NO_TRANSFORM_PARENT}
                              onValueChange={(value) =>
                                applyTransformParentMenuSelection({
                                  value,
                                  currentParentItemId: parentItemId,
                                  childItemId: item.id,
                                  itemById,
                                  keyframesByItemId,
                                  canvas: transformParentCanvas,
                                  t,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={t('editor.compose.parentForLayer', {
                                  defaultValue: 'Parent for {{name}}',
                                  name: item.label || item.type,
                                })}
                                className="h-6 min-w-0 flex-1 gap-1 border-transparent bg-transparent px-1.5 py-0 text-[9px] shadow-none hover:border-input hover:bg-background data-[state=open]:border-primary/50 data-[state=open]:bg-background [&>svg]:h-3 [&>svg]:w-3"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_TRANSFORM_PARENT} className="text-[10px]">
                                  {t('editor.transformHierarchy.none', { defaultValue: 'None' })}
                                </SelectItem>
                                {parentCandidates.map(({ item: candidate, layerNumber }) => (
                                  <SelectItem
                                    key={candidate.id}
                                    value={candidate.id}
                                    className="text-[10px]"
                                  >
                                    <span className="mr-1 text-muted-foreground">
                                      {layerNumber}.
                                    </span>
                                    {candidate.type === 'controller'
                                      ? t('editor.transformHierarchy.controllerOption', {
                                          defaultValue: 'Null: {{name}}',
                                          name: candidate.label,
                                        })
                                      : candidate.label || candidate.type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div
                            data-testid={`motion-timing-cell-${item.id}`}
                            className="flex shrink-0 items-center gap-1 border-l border-border px-1"
                            style={{ width: LAYER_TIMING_COLUMN_WIDTH }}
                          >
                            <LayerFrameInput
                              label="I"
                              ariaLabel={t('editor.compose.inFrame')}
                              value={item.from}
                              min={0}
                              max={Math.max(0, item.from + item.durationInFrames - 1)}
                              disabled={isLayerLocked}
                              onCommit={(nextFrom) =>
                                updateItem(item.id, {
                                  from: nextFrom,
                                  durationInFrames: Math.max(
                                    1,
                                    item.from + item.durationInFrames - nextFrom,
                                  ),
                                })
                              }
                            />
                            <LayerFrameInput
                              label="O"
                              ariaLabel={t('editor.compose.outFrame')}
                              value={item.from + item.durationInFrames}
                              min={item.from + 1}
                              max={durationInFrames}
                              disabled={isLayerLocked}
                              onCommit={(nextOut) =>
                                updateItem(item.id, {
                                  durationInFrames: Math.max(1, nextOut - item.from),
                                })
                              }
                            />
                          </div>
                          <div
                            className="flex shrink-0 items-center border-l border-border px-1"
                            style={{ width: LAYER_MODE_COLUMN_WIDTH }}
                          >
                            <Select
                              disabled={isLayerLocked}
                              value={item.blendMode ?? 'normal'}
                              onValueChange={(value) =>
                                updateItem(item.id, { blendMode: value as BlendMode })
                              }
                            >
                              <SelectTrigger
                                className="h-5 w-full gap-1 bg-background px-2 text-[9px] text-muted-foreground"
                                aria-label={t('editor.compose.blendMode')}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {ALL_BLEND_MODES.map((mode) => (
                                  <SelectItem key={mode} value={mode} className="text-[10px]">
                                    {BLEND_MODE_LABELS[mode]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="relative min-w-0 flex-1 cursor-default overflow-hidden">
                          <div
                            data-motion-timeline-lane
                            data-motion-viewport-surface
                            className="absolute inset-0 overflow-hidden"
                            onPointerDown={beginPlayheadScrub}
                            onPointerMove={movePlayheadScrub}
                            onPointerUp={endPlayheadScrub}
                            onPointerCancel={endPlayheadScrub}
                          >
                            {Array.from({ length: RULER_DIVISIONS + 1 }, (_, tick) => (
                              <div
                                key={tick}
                                data-motion-static-x
                                className="pointer-events-none absolute inset-y-0 border-l border-border/45"
                                style={{ left: `${(tick / RULER_DIVISIONS) * 100}%` }}
                              />
                            ))}
                            {!activeInlineCurve ? (
                              <button
                                type="button"
                                data-testid={`motion-layer-span-${item.id}`}
                                data-motion-span-drag-visual
                                data-from-frame={item.from}
                                data-to-frame={item.from + item.durationInFrames}
                                disabled={isLayerLocked}
                                onPointerDown={(event) =>
                                  !isLayerLocked &&
                                  beginSpanDrag(
                                    event,
                                    selected && !(event.metaKey || event.ctrlKey || event.shiftKey)
                                      ? selectedItemIds
                                      : [item.id],
                                  )
                                }
                                onPointerMove={moveSpanDrag}
                                onPointerUp={endSpanDrag}
                                onPointerCancel={cancelSpanDrag}
                                onClick={(event) => {
                                  event.stopPropagation()
                                }}
                                className={cn(
                                  '@container absolute top-1/2 h-5 -translate-y-1/2 touch-none overflow-hidden rounded-sm border px-1 text-left text-[9px] shadow-sm transition-colors',
                                  isLayerLocked
                                    ? 'cursor-not-allowed opacity-55'
                                    : 'cursor-grab active:cursor-grabbing',
                                  selected
                                    ? 'border-foreground/80 bg-timeline-motion-segment/90 text-foreground'
                                    : 'border-timeline-motion-segment/80 bg-timeline-motion-segment/70 text-foreground hover:bg-timeline-motion-segment/85',
                                )}
                                style={{
                                  left: `${frameToMotionPercent(item.from)}%`,
                                  width: `${Math.max(0.6, (item.durationInFrames / visibleFrameRange) * 100)}%`,
                                }}
                                title={`${item.from}–${item.from + item.durationInFrames - 1}`}
                              >
                                {!isLayerLocked ? (
                                  <>
                                    <span
                                      role="slider"
                                      aria-label={`Trim ${item.label || item.type} start`}
                                      aria-valuemin={0}
                                      aria-valuemax={item.from + item.durationInFrames - 1}
                                      aria-valuenow={item.from}
                                      tabIndex={-1}
                                      data-testid={`motion-trim-start-${item.id}`}
                                      onPointerDown={(event) => beginSpanTrim(event, item, 'start')}
                                      onPointerMove={moveSpanTrim}
                                      onPointerUp={endSpanTrim}
                                      onPointerCancel={cancelSpanTrim}
                                      className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none bg-foreground/10 opacity-70 hover:bg-foreground/25 hover:opacity-100"
                                    />
                                    <span
                                      role="slider"
                                      aria-label={`Trim ${item.label || item.type} end`}
                                      aria-valuemin={item.from + 1}
                                      aria-valuemax={durationInFrames}
                                      aria-valuenow={item.from + item.durationInFrames}
                                      tabIndex={-1}
                                      data-testid={`motion-trim-end-${item.id}`}
                                      onPointerDown={(event) => beginSpanTrim(event, item, 'end')}
                                      onPointerMove={moveSpanTrim}
                                      onPointerUp={endSpanTrim}
                                      onPointerCancel={cancelSpanTrim}
                                      className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none bg-foreground/10 opacity-70 hover:bg-foreground/25 hover:opacity-100"
                                    />
                                  </>
                                ) : null}
                                <span className="pointer-events-none block truncate px-1.5">
                                  {item.label || item.type}
                                </span>
                                {hasProceduralMotion ? (
                                  <span
                                    data-testid={`motion-procedural-badge-${item.id}`}
                                    className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border border-sky-300/45 bg-sky-950/75 px-1 font-mono text-[8px] font-semibold text-sky-200 @min-[44px]:block"
                                    title={t('timeline.clipIndicators.hasMotion')}
                                  >
                                    ƒx
                                  </span>
                                ) : null}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </MotionRowContextMenu>

                    {expanded ? (
                      <div inert={isLayerLocked ? true : undefined} aria-disabled={isLayerLocked}>
                        {isPathShape ? (
                          <div
                            className="flex h-7 border-b border-border/70 bg-background/45"
                            data-testid={`motion-path-vertex-toolbar-${item.id}`}
                          >
                            <div
                              className="flex items-center justify-between gap-2 border-r border-border px-2 text-[10px] text-muted-foreground"
                              style={{ width: LAYER_COLUMN_WIDTH }}
                            >
                              <span>
                                {showAllPathVertices
                                  ? 'All path vertices'
                                  : maskEditingItemId === item.id &&
                                      selectedPathVertexIndices.length > 0
                                    ? `${selectedPathVertexIndices.length} selected ${
                                        selectedPathVertexIndices.length === 1
                                          ? 'vertex'
                                          : 'vertices'
                                      }`
                                    : 'Vertex 1'}
                              </span>
                              <button
                                type="button"
                                className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                                data-testid={`motion-toggle-all-path-vertices-${item.id}`}
                                aria-pressed={showAllPathVertices}
                                onClick={() =>
                                  setAllPathVertexItemIds((current) => {
                                    const next = new Set(current)
                                    if (next.has(item.id)) next.delete(item.id)
                                    else next.add(item.id)
                                    return next
                                  })
                                }
                              >
                                {showAllPathVertices ? 'Selected vertices' : 'All vertices'}
                              </button>
                            </div>
                            <div className="flex flex-1 items-center px-2 text-[10px] text-muted-foreground/70">
                              Select path points in the preview to focus these channels.
                            </div>
                          </div>
                        ) : null}
                        {textMotionBands.length > 0 ? (
                          <TextMotionTimelineLanes
                            itemId={item.id}
                            bands={textMotionBands}
                            timeViewport={timeViewport}
                          />
                        ) : null}
                        <MotionDopesheetLanes
                          item={item}
                          itemById={itemById}
                          itemKeyframes={keyframesByItemId[item.id]}
                          properties={properties}
                          compositionDurationInFrames={durationInFrames}
                          fps={fps}
                          canvas={composition}
                          propertyFilter={propertyFilter}
                          timeViewport={timeViewport}
                          inlineCurveProperty={
                            activeInlineCurve?.itemId === item.id
                              ? activeInlineCurve.property
                              : null
                          }
                          disabled={isLayerLocked}
                          onSelectItem={(itemId) => selectItems([itemId])}
                          onInlineCurveChange={(property) => {
                            setInlineCurve(
                              property
                                ? {
                                    compositionId: activeCompositionId,
                                    itemId: item.id,
                                    property,
                                  }
                                : null,
                            )
                          }}
                          onScrub={(frame) => {
                            pause()
                            setScrubFrame(frame)
                          }}
                          onTimeViewportChange={updateTimeViewport}
                          onPropertyLinkPointerDown={beginPropertyLinkDrag}
                          onRemovePropertyLink={handleRemovePropertyLink}
                          onSetPropertyExpression={handleSetPropertyExpression}
                          onRemovePropertyExpression={handleRemovePropertyExpression}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>
        {activeInlineCurve && activeCurveItem ? (
          <div
            data-testid="motion-graph-pane"
            className="absolute bottom-0 right-0 z-25 overflow-hidden border-l border-border bg-background"
            style={{ left: TIMELINE_CONTENT_LEFT, top: RULER_HEIGHT }}
          >
            <MotionDopesheetLanes
              item={activeCurveItem}
              itemById={itemById}
              itemKeyframes={keyframesByItemId[activeCurveItem.id]}
              disabled={isActiveCurveLocked}
              properties={activeCurveProperties}
              compositionDurationInFrames={durationInFrames}
              fps={fps}
              canvas={composition}
              propertyFilter={propertyFilter}
              timeViewport={timeViewport}
              inlineCurveProperty={activeInlineCurve.property}
              paneMode="graph"
              onSelectItem={(itemId) => selectItems([itemId])}
              onInlineCurveChange={(property) => {
                setInlineCurve(
                  property
                    ? {
                        compositionId: activeCompositionId,
                        itemId: activeCurveItem.id,
                        property,
                      }
                    : null,
                )
              }}
              onScrub={(frame) => {
                pause()
                setScrubFrame(frame)
              }}
              onTimeViewportChange={updateTimeViewport}
              onPropertyLinkPointerDown={beginPropertyLinkDrag}
              onRemovePropertyLink={handleRemovePropertyLink}
              onSetPropertyExpression={handleSetPropertyExpression}
              onRemovePropertyExpression={handleRemovePropertyExpression}
            />
          </div>
        ) : null}
      </div>
      <div className="flex h-5 shrink-0 bg-background/80">
        <div
          className="shrink-0 border-r border-t border-border"
          style={{ width: LAYER_COLUMN_WIDTH }}
        />
        <div
          ref={motionTimeNavigatorRef}
          className="relative min-w-0 flex-1"
          data-testid="motion-time-navigator"
          data-start-frame={timeViewport.startFrame}
          data-end-frame={timeViewport.endFrame}
        >
          <MotionCompactNavigator
            viewport={timeViewport}
            contentFrameMax={durationInFrames}
            minVisibleFrames={Math.min(10, durationInFrames)}
            onViewportChange={commitMotionTimeViewport}
            onViewportPreviewStart={prepareNavigatorMotionTimeViewportPreview}
            onViewportPreview={previewMotionTimeViewport}
          />
          <div className="pointer-events-none absolute inset-x-2 bottom-1 top-[5px] overflow-hidden rounded-sm">
            <div
              data-testid="motion-navigator-frame-axis-overlay"
              className="absolute inset-y-0 overflow-hidden"
              style={{ left: KEYFRAME_EDGE_INSET, right: KEYFRAME_EDGE_INSET }}
            >
              <MotionActiveRegionOverlay
                viewport={{ startFrame: 0, endFrame: durationInFrames }}
                compositionEndFrame={compositionEndFrame}
                testId="motion-navigator-active-region-overlay"
                compositionEndTestId="motion-navigator-comp-end-dim"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <section
        className={cn(
          'flex min-h-0 flex-1 overflow-hidden border-t border-border transition-shadow',
          dropActive && 'ring-1 ring-inset ring-primary/60',
          className,
        )}
        data-testid="compositing-timeline"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {layerSheet}
      </section>
      {propertyLinkDrag ? <PropertyLinkPickWhipOverlay drag={propertyLinkDrag} /> : null}
      {transformParentDrag ? <TransformParentPickWhipOverlay drag={transformParentDrag} /> : null}
      <NewCompositionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaults={dialogDefaults}
      />
    </>
  )
})

/**
 * Keep the mandatory external-store notification tiny. The canonical timeline
 * transform and undo entry are still committed synchronously, while the large
 * Motion tree consumes the coherent item/index snapshot as interruptible work.
 */
export const CompositingTimeline = memo(function CompositingTimeline(
  props: CompositingTimelineProps,
) {
  const itemsSnapshot = useItemsStore(
    useShallow((state) => ({
      items: state.items,
      tracks: state.tracks,
      itemById: state.itemById,
    })),
  )
  return <DeferredCompositingTimeline {...props} itemsSnapshot={itemsSnapshot} />
})

/**
 * The external-store bridge above stays on a separate fiber so a later store
 * notification cannot promote this transition into the pointer-up task.
 * Structural edits remain synchronous; only the one translate commit that
 * matches the current gizmo interaction is allowed to catch up concurrently.
 */
const DeferredCompositingTimeline = memo(function DeferredCompositingTimeline({
  itemsSnapshot,
  ...props
}: CompositingTimelineCoreProps) {
  const deferredItemsSnapshot = useRafDeferredValue(itemsSnapshot)
  const pendingTranslateInteractionRef = useRef<number | null>(null)
  const gizmoState = useGizmoStore.getState()
  const presentation =
    gizmoState.activeGizmo?.mode === 'translate'
      ? {
          interactionId: gizmoState.activeGizmo.interactionId,
          itemId: gizmoState.activeGizmo.itemId,
        }
      : gizmoState.presentationHandoff?.mode === 'translate'
        ? {
            interactionId: gizmoState.presentationHandoff.interactionId,
            itemId: gizmoState.presentationHandoff.itemId,
          }
        : null
  const isPendingTranslateCommit =
    deferredItemsSnapshot !== itemsSnapshot &&
    presentation !== null &&
    isTranslateOnlyItemsSnapshotChange(deferredItemsSnapshot, itemsSnapshot, presentation.itemId)

  if (isPendingTranslateCommit) {
    pendingTranslateInteractionRef.current = presentation.interactionId
  } else if (deferredItemsSnapshot === itemsSnapshot) {
    pendingTranslateInteractionRef.current = null
  }

  const renderedSnapshot =
    isPendingTranslateCommit &&
    pendingTranslateInteractionRef.current === presentation?.interactionId
      ? deferredItemsSnapshot
      : itemsSnapshot

  return <CompositingTimelineCore {...props} itemsSnapshot={renderedSnapshot} />
})
