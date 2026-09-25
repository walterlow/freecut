import { MotionDopesheetLanes } from './motion-dopesheet-content'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { ChevronDown, ClipboardPaste, Blend, Copy, Crop, CopyPlus, Crosshair, Group, Maximize2, Plus, Pencil, Spline, Square, Type, Trash2, Ungroup } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { useRafDeferredValue } from '@/shared/hooks/use-raf-deferred-value'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useClipboardStore } from '@/shared/state/clipboard'
import type { DirectLinkableProperty } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { addItemOnNewTrack, addItemsOnNewTracks, buildDroppedCompositionTimelineItems, buildDroppedMediaTimelineItems, captureSnapshot, CompactNavigator, createTimelineTemplateItem, createDefaultControllerItem, createDefaultGradientItem, createDefaultShapeItem, createDefaultSolidColorItem, createTextTemplateItem, PropertyLinkPickWhipOverlay, getAnimatablePropertiesForItem, getDroppedMediaDurationInFrames, isTimelineTemplateDragData, KEYFRAME_EDGE_INSET, moveItems, openComposition, resolveDroppedMediaEntriesFromPayload, setPropertyExpression, removePropertyExpression, setTracks, updateItem, useCompositionNavigationStore, useCompositionsStore, useItemsStore, useKeyframesStore, useKeyframeSelectionStore, useTimelineCommandStore, useTimelineSettingsStore, usePropertyLinkPickWhip, wouldCreateCompositionCycle } from '@/features/editor/deps/timeline-motion'
import { clearSpanDragVisuals, clearSpanTrimVisuals, createMotionSpanDragCommands, createMotionSpanTrimCommands, type SpanDragState, type SpanTrimState } from './motion-span-interactions'
import { createMotionRowReorderCommands, type RowReorderDragState } from './motion-row-reorder'
import { advanceMotionScrubPan, createMotionTimeViewportController, formatFrameTime, normalizeMotionTimeViewport, resolveMotionScrubFramePaint, type MotionTimeViewport, type MotionTimeViewportController } from './motion-time-viewport-controller'
import { collectMotionViewportPreviewElements, collectMotionViewportPreviewGrids, collectMotionViewportPreviewNavigator, collectMotionViewportPreviewPlayhead, collectMotionViewportPreviewRulerLabels, paintMotionViewportGrids, paintMotionViewportNavigator, paintMotionViewportPlayhead, paintMotionViewportRulerLabels, paintMotionViewportTargets } from './motion-time-viewport-preview'
import { createMotionLayerClipboardCommands } from './motion-layer-clipboard'
import { createMotionLayerSelectionCommands } from './motion-layer-selection'
import { getVisibleMotionRetimeRange, getRetimeKeyboardDelta, applyMotionSelectionFrameUpdates, restoreMotionSelectionRetimeVisuals, type MotionSelectionRetimeDragState, createMotionSelectionRetimeCommands } from './motion-selection-retime'
import { LAYER_COLUMN_WIDTH, LAYER_MODE_COLUMN_WIDTH, LAYER_PARENT_COLUMN_WIDTH, LAYER_ROW_HEIGHT, LAYER_TIMING_COLUMN_WIDTH, RULER_DIVISIONS, useSettledMotionFrame, type MotionViewportPreviewState, type MotionMiddlePanState, type InlineCurveState, type RenameTarget } from './motion-timeline-primitives'
import { useGizmoStore, useMaskEditorStore } from '@/features/editor/deps/preview'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { trimCompositionToActiveRegion, useMarkersStore } from '@/features/editor/deps/timeline-store'
import { clearMediaDragData, getMediaDragData, resolveMediaUrl, useMediaLibraryStore } from '@/features/editor/deps/media-library-contract'
import { useComposeUiStore } from './compose-ui-store'
import { NewCompositionDialog } from './new-composition-dialog'
import { TransformParentPickWhipOverlay } from './transform-parent-pick-whip-overlay'
import { useTransformParentPickWhip } from './use-transform-parent-pick-whip'
import { buildMotionSelectionDragState, buildMotionSelectionRetimeUpdates, getMotionSelectionTimeRange } from './motion-keyframe-selection'
import { MotionIoLane, MOTION_IO_LANE_HEIGHT } from './motion-io-lane'
import { MotionActiveRegionOverlay, MotionCompEndRulerDim } from './motion-region-overlay'
import {
  buildMotionGroupRowModel,
  buildMotionLayerRowModel,
  buildMotionRows,
  type LayerEntry,
  type MotionRow,
} from './motion-layer-row-model'
import { MotionLayerLane } from './motion-layer-lane'
import { MotionLayerPropertyRows } from './motion-layer-property-rows'
import {
  MotionLayerModeCell,
  MotionLayerNameCell,
  MotionLayerParentCell,
  MotionLayerTimingCell,
} from './motion-layer-row-cells'
import { MotionGroupLaneCell, MotionGroupNameCell } from './motion-group-row-cells'
import {
  isTranslateOnlyItemsSnapshotChange,
  resolveTranslatePresentation,
  type CompositingTimelineItemsSnapshot,
} from './motion-timeline-items-snapshot'

const TIMELINE_CONTENT_LEFT = LAYER_COLUMN_WIDTH + 1
// Tick labels on top, the in/out render-range lane along the bottom.
const RULER_HEIGHT = 28 + MOTION_IO_LANE_HEIGHT
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
const EMPTY_LAYER_IDS: string[] = []



const logger = createLogger('MotionTimeline')






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




interface CompositingTimelineProps {
  className?: string
  defaults?: { width: number; height: number; fps: number }
}

interface CompositingTimelineCoreProps extends CompositingTimelineProps {
  itemsSnapshot: CompositingTimelineItemsSnapshot
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
  // Wheel navigation state lives in its own controller: queued viewport
  // previews, the settle timer and the gesture's locked pan axis. The mirrors
  // below keep it reading the current render without re-creating it, since a
  // re-created controller would orphan an in-flight settle timer.
  const durationInFramesRef = useRef(0)
  const preparePreviewRef = useRef<() => void>(() => {})
  const previewViewportRef = useRef<(viewport: MotionTimeViewport) => void>(() => {})
  const commitViewportRef = useRef<
    (viewport: MotionTimeViewport, roundToFrames?: boolean) => void
  >(() => {})
  const viewportControllerRef = useRef<MotionTimeViewportController | null>(null)
  if (!viewportControllerRef.current) {
    viewportControllerRef.current = createMotionTimeViewportController({
      layerColumnWidth: LAYER_COLUMN_WIDTH,
      getDurationInFrames: () => durationInFramesRef.current,
      getTimeViewport: () => timeViewportRef.current,
      preparePreview: () => preparePreviewRef.current(),
      previewViewport: (viewport) => previewViewportRef.current(viewport),
      commitViewport: (viewport, roundToFrames) =>
        commitViewportRef.current(viewport, roundToFrames),
      getScrollArea: () => motionScrollAreaRef.current,
    })
  }
  const viewportController = viewportControllerRef.current
  const [motionScrollbarWidth, setMotionScrollbarWidth] = useState(0)
  const [allPathVertexItemIds, setAllPathVertexItemIds] = useState<Set<string>>(
    () => new Set(),
  )
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
  const selectedPathVertexIndices = useMaskEditorStore(
    (state) => state.selectedVertexIndices,
  )
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
  const canTrimToActiveRegion = useMarkersStore(
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
    const grids = collectMotionViewportPreviewGrids(root)
    const elements = collectMotionViewportPreviewElements({ root, baseViewport, baseRange })
    const playhead = collectMotionViewportPreviewPlayhead(
      root.querySelector<HTMLElement>('[data-testid="motion-playhead"]'),
    )
    const rulerLabels = collectMotionViewportPreviewRulerLabels(root)
    const navigator = collectMotionViewportPreviewNavigator(motionTimeNavigatorRef.current)
    motionViewportPreviewRef.current = {
      baseViewport,
      elements,
      grids,
      playhead,
      rulerLabels,
      navigator,
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

      paintMotionViewportGrids(preview.grids, viewport, nextRange)
      paintMotionViewportTargets(preview.elements, viewport, nextRange)
      if (preview.playhead) {
        const playback = usePlaybackStore.getState()
        paintMotionViewportPlayhead(preview.playhead, {
          frame: playback.previewFrame ?? playback.currentFrame,
          viewport,
          nextRange,
          scrubProgress: scrubPlayheadProgress,
        })
      }
      paintMotionViewportRulerLabels(preview.rulerLabels, viewport, nextRange, fps)
      if (preview.navigator) {
        paintMotionViewportNavigator(preview.navigator, viewport, durationInFrames)
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
    viewportController.cancel()
    // Fit the active region when one is marked, else the comp itself — never the
    // content overhang past the comp end, which does not render. Read in/out at
    // click time so an IO drag doesn't re-render this whole timeline per frame.
    const { inPoint, outPoint } = useMarkersStore.getState()
    const fittedViewport =
      inPoint !== null && outPoint !== null && outPoint > inPoint
        ? { startFrame: inPoint, endFrame: outPoint }
        : { startFrame: 0, endFrame: compositionEndFrame ?? durationInFrames }
    previewMotionTimeViewport(fittedViewport)
    commitMotionTimeViewport(fittedViewport)
  }, [
    viewportController,
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
  // Wire the controller to this render's viewport inputs. Assigned every render
  // rather than captured at creation, so a composition switch cannot leave a
  // queued preview working against a stale duration.
  durationInFramesRef.current = durationInFrames
  preparePreviewRef.current = prepareMotionTimeViewportPreview
  previewViewportRef.current = previewMotionTimeViewport
  commitViewportRef.current = commitMotionTimeViewport
  useEffect(() => viewportController.cancel, [viewportController])
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
    () => (activeCurveItem ? getAnimatablePropertiesForItem(activeCurveItem) : []),
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

  // Retiming commands over the drag's refs: the refs keep an in-flight gesture
  // (and its preview frame) alive while the callbacks come from this render.
  const selectionRetime = useMemo(
    () =>
      createMotionSelectionRetimeCommands({
        state: {
          dragRef: selectionRetimeDragRef,
          pendingFrameRef: pendingSelectionRetimeFrameRef,
          animationFrameRef: selectionRetimeAnimationFrameRef,
        },
        deps: {
          durationInFrames,
          visibleFrameRange,
          selection: motionSelectionDragState,
          selectionTimeRange: motionSelectionTimeRange,
          itemById,
          getRuler: () => motionRulerRef.current,
          getScrollArea: () => motionScrollAreaRef.current,
          getRangeElement: () => motionSelectionRetimeRangeRef.current,
          getTimeViewport: () => timeViewportRef.current,
        },
      }),
    [
      durationInFrames,
      itemById,
      motionSelectionDragState,
      motionSelectionTimeRange,
      visibleFrameRange,
    ],
  )
  const beginSelectionRetime = selectionRetime.begin
  const moveSelectionRetime = selectionRetime.move
  const endSelectionRetime = selectionRetime.end
  const cancelSelectionRetime = selectionRetime.cancel

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
  const motionRows = useMemo<MotionRow[]>(
    () => buildMotionRows(layerEntries, tracks),
    [layerEntries, tracks],
  )
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

  // Selection and grouping are commands over the current selection and row
  // order; the anchor ref survives re-renders so Shift ranges keep their origin.
  const layerSelection = useMemo(
    () =>
      createMotionLayerSelectionCommands({
        state: { anchorIdRef: selectionAnchorIdRef },
        deps: {
          selectedItemIds,
          selectedItemIdSet,
          visibleLayerIds,
          layerEntries,
          tracks,
          layerRowHeight: LAYER_ROW_HEIGHT,
          selectItems,
          formatGroupName: (groupNumber) => t('editor.compose.groupName', { count: groupNumber }),
        },
      }),
    [layerEntries, selectItems, selectedItemIdSet, selectedItemIds, t, tracks, visibleLayerIds],
  )
  const selectLayer = layerSelection.selectLayer
  const prepareLayerContextMenu = layerSelection.prepareLayerContextMenu
  const prepareGroupContextMenu = layerSelection.prepareGroupContextMenu
  const createGroupFromSelection = layerSelection.createGroupFromSelection
  const ungroupTracks = layerSelection.ungroupTracks

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

  // Layer clipboard commands. Rebuilt when the data they read changes; the
  // clipboard itself lives in its own store and is read at call time.
  const layerClipboard = useMemo(
    () =>
      createMotionLayerClipboardCommands({
        items,
        tracks,
        trackById,
        compositionById,
        activeCompositionId,
        layerRowHeight: LAYER_ROW_HEIGHT,
        selectItems,
        expandLayerItemIds: expandMotionLayerItemIds,
      }),
    [
      activeCompositionId,
      compositionById,
      expandMotionLayerItemIds,
      items,
      selectItems,
      trackById,
      tracks,
    ],
  )
  const copyLayers = layerClipboard.copy
  const duplicateLayers = layerClipboard.duplicate
  const pasteLayers = layerClipboard.paste
  const deleteLayers = layerClipboard.delete

  // Span dragging is a command object over the component's drag refs, rebuilt
  // when its inputs change; the refs keep an in-flight drag (and its preview
  // frame) alive across renders.
  const spanDrag = useMemo(
    () =>
      createMotionSpanDragCommands({
        state: {
          dragRef: spanDragRef,
          visualsRef: spanDragVisualsRef,
          animationFrameRef: spanDragAnimationFrameRef,
        },
        deps: {
          items,
          durationInFrames,
          visibleFrameRange,
          pause,
          selectLayer,
          selectItems,
          moveItems,
          expandLayerItemIds: expandMotionLayerItemIds,
          getScrollArea: () => motionScrollAreaRef.current,
        },
      }),
    [
      durationInFrames,
      expandMotionLayerItemIds,
      items,
      pause,
      selectItems,
      selectLayer,
      visibleFrameRange,
    ],
  )
  const spanTrim = useMemo(
    () =>
      createMotionSpanTrimCommands({
        state: { trimRef: spanTrimRef, animationFrameRef: spanTrimAnimationFrameRef },
        deps: { durationInFrames, visibleFrameRange, pause, selectItems },
      }),
    [durationInFrames, pause, selectItems, visibleFrameRange],
  )
  const rowReorder = useMemo(
    () =>
      createMotionRowReorderCommands({
        state: {
          dragRef: rowReorderDragRef,
          animationFrameRef: rowReorderAnimationFrameRef,
          pendingClientYRef: pendingRowReorderClientYRef,
        },
        deps: { setDrag: setRowReorderDrag },
      }),
    [],
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

  useEffect(() => () => rowReorder.dispose(), [rowReorder])

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
      const activeViewport = playheadScrubViewportRef.current
      if (pointerId === null || clientX === null || !surface || !activeViewport) return
      let viewport: MotionTimeViewport = activeViewport

      const rect = surface.getBoundingClientRect()
      const pan = advanceMotionScrubPan({
        viewport,
        clientX,
        bounds: rect,
        compositionEndFrame,
        durationInFrames,
        previousTimestamp: scrubAnimationTimeRef.current,
        timestamp,
      })
      scrubAnimationTimeRef.current = pan.clock
      viewport = pan.viewport
      if (pan.panning) playheadScrubViewportRef.current = pan.viewport

      const paint = resolveMotionScrubFramePaint({
        frame: frameFromClientX(clientX, surface, viewport),
        latestFrame: latestScrubFrameRef.current,
        viewport,
        committedViewport: timeViewportRef.current,
        clientX,
        bounds: rect,
      })
      if (paint.frame !== null) {
        latestScrubFrameRef.current = paint.frame
        setPreviewFrame(paint.frame)
      }
      // Keep the drag visual locked to the pointer. The preview frame remains
      // integer-quantized, which otherwise produces a visible sawtooth while
      // the viewport itself advances by fractional frames.
      if (paint.viewport) previewMotionTimeViewport(paint.viewport, paint.progress)

      if (pan.panning) {
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


  useEffect(() => {
    const navigationRoot = motionViewportPreviewRootRef.current
    if (!navigationRoot) return
    return viewportController.attach(navigationRoot)
  }, [viewportController])

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
    const { groupSelected, groupFrom, groupEnd, groupItemIds, groupTrackIds, isDragging } =
      buildMotionGroupRowModel({ row, tracks, selectedItemIdSet, rowReorderDrag })

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
            <MotionGroupNameCell
              track={row.track}
              layerCount={row.items.length}
              groupItemIds={groupItemIds}
              renameTarget={renameTarget}
              renameDraft={renameDraft}
              t={t}
              rowReorder={rowReorder}
              updateLayerTrack={updateLayerTrack}
              setAllTracksLocked={setAllTracksLocked}
              selectGroupItems={selectItems}
              ungroup={ungroupTracks}
              beginRename={beginRename}
              commitRename={commitRename}
              setRenameDraft={setRenameDraft}
              setRenameTarget={setRenameTarget}
            />
            <MotionGroupLaneCell
              track={row.track}
              groupItemIds={groupItemIds}
              groupFrom={groupFrom}
              groupEnd={groupEnd}
              activeInlineCurve={activeInlineCurve}
              frameToMotionPercent={frameToMotionPercent}
              visibleFrameRange={visibleFrameRange}
              spanDrag={spanDrag}
              beginPlayheadScrub={beginPlayheadScrub}
              movePlayheadScrub={movePlayheadScrub}
              endPlayheadScrub={endPlayheadScrub}
            />
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
                const {
                  parentItemId,
                  parentCandidates,
                  expanded,
                  selected,
                  isParentLayerGroupLocked,
                  isLayerLocked,
                  LayerTypeIcon: MotionLayerTypeIcon,
                  isPathShape,
                  showAllPathVertices,
                  properties,
                  textMotionBands,
                  hasProceduralMotion,
                  hasVisibleChildProperties,
                  isDragging,
                  nullObjectNonRenderingLabel,
                } = buildMotionLayerRowModel({
                  item,
                  track,
                  layerEntries,
                  itemKeyframes: keyframesByItemId[item.id],
                  trackById,
                  expandedLayerIdSet,
                  selectedItemIdSet,
                  allPathVertexItemIds,
                  maskEditingItemId,
                  selectedPathVertexIndices,
                  activeInlineCurve,
                  propertyFilter,
                  rowReorderDrag,
                  t,
                })
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
                          <MotionLayerNameCell
                            item={item}
                            index={index}
                            depth={depth}
                            track={track}
                            LayerTypeIcon={MotionLayerTypeIcon}
                            activeCompositionId={activeCompositionId}
                            layerEntries={layerEntries}
                            expanded={expanded}
                            hasVisibleChildProperties={hasVisibleChildProperties}
                            isLayerLocked={isLayerLocked}
                            isParentLayerGroupLocked={isParentLayerGroupLocked}
                            nullObjectNonRenderingLabel={nullObjectNonRenderingLabel}
                            renameTarget={renameTarget}
                            renameDraft={renameDraft}
                            t={t}
                            rowReorder={rowReorder}
                            layerSelection={layerSelection}
                            updateLayerTrack={updateLayerTrack}
                            setAllTracksLocked={setAllTracksLocked}
                            toggleLayerExpanded={toggleLayerExpanded}
                            setAllLayersExpanded={setAllLayersExpanded}
                            beginRename={beginRename}
                            commitRename={commitRename}
                            setRenameDraft={setRenameDraft}
                            setRenameTarget={setRenameTarget}
                          />
                          <MotionLayerParentCell
                            item={item}
                            parentItemId={parentItemId}
                            parentCandidates={parentCandidates}
                            isLayerLocked={isLayerLocked}
                            itemById={itemById}
                            keyframesByItemId={keyframesByItemId}
                            canvas={transformParentCanvas}
                            t={t}
                            beginTransformParentDrag={beginTransformParentDrag}
                          />
                          <MotionLayerTimingCell
                            item={item}
                            isLayerLocked={isLayerLocked}
                            durationInFrames={durationInFrames}
                            t={t}
                            updateItem={updateItem}
                          />
                          <MotionLayerModeCell
                            item={item}
                            isLayerLocked={isLayerLocked}
                            t={t}
                            updateItem={updateItem}
                          />
                        </div>
                        <MotionLayerLane
                          item={item}
                          isLayerLocked={isLayerLocked}
                          selected={selected}
                          selectedItemIds={selectedItemIds}
                          activeInlineCurve={activeInlineCurve}
                          hasProceduralMotion={hasProceduralMotion}
                          durationInFrames={durationInFrames}
                          frameToMotionPercent={frameToMotionPercent}
                          visibleFrameRange={visibleFrameRange}
                          t={t}
                          spanDrag={spanDrag}
                          spanTrim={spanTrim}
                          beginPlayheadScrub={beginPlayheadScrub}
                          movePlayheadScrub={movePlayheadScrub}
                          endPlayheadScrub={endPlayheadScrub}
                        />
                      </div>
                    </MotionRowContextMenu>

                    <MotionLayerPropertyRows
                      item={item}
                      expanded={expanded}
                      isLayerLocked={isLayerLocked}
                      isPathShape={isPathShape}
                      showAllPathVertices={showAllPathVertices}
                      maskEditingItemId={maskEditingItemId}
                      selectedPathVertexIndices={selectedPathVertexIndices}
                      setAllPathVertexItemIds={setAllPathVertexItemIds}
                      textMotionBands={textMotionBands}
                      timeViewport={timeViewport}
                      itemById={itemById}
                      itemKeyframes={keyframesByItemId[item.id]}
                      properties={properties}
                      durationInFrames={durationInFrames}
                      fps={fps}
                      canvas={composition}
                      propertyFilter={propertyFilter}
                      activeInlineCurve={activeInlineCurve}
                      activeCompositionId={activeCompositionId}
                      selectItems={selectItems}
                      setInlineCurve={setInlineCurve}
                      pause={pause}
                      setScrubFrame={setScrubFrame}
                      updateTimeViewport={updateTimeViewport}
                      beginPropertyLinkDrag={beginPropertyLinkDrag}
                      handleRemovePropertyLink={handleRemovePropertyLink}
                      handleSetPropertyExpression={handleSetPropertyExpression}
                      handleRemovePropertyExpression={handleRemovePropertyExpression}
                    />
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
            onViewportPreviewStart={viewportController.prepareNavigatorPreview}
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
  const presentation = resolveTranslatePresentation(
    gizmoState.activeGizmo,
    gizmoState.presentationHandoff,
  )
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
