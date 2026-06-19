/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from 'react-hotkeys-hook'
import { ChevronDown, ChevronLeft, ChevronRight, LineChart, Lock, Timer, X } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingType,
  Keyframe,
  KeyframeRef,
} from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout'
import { CompactNavigator } from './compact-navigator'
import { DopesheetClipboardActions } from './dopesheet-clipboard-actions'
import { DopesheetEditActions } from './dopesheet-edit-actions'
import { DopesheetGraphPane } from './dopesheet-graph-pane'
import { useGraphViewState } from './use-graph-view-state'
import { useGroupExpansion } from './use-group-expansion'
import { useHeaderFrameInputs } from './use-header-frame-inputs'
import { usePropertyFilters } from './use-property-filters'
import { useDopesheetMarquee } from './use-dopesheet-marquee'
import { useTimingStripDrag } from './use-timing-strip-drag'
import { useDopesheetViewport } from './use-dopesheet-viewport'
import { useElementSize } from './use-element-size'
import { addWindowPointerListeners } from './dopesheet-pointer-listeners'
import { DopesheetHeaderFrameInputs } from './dopesheet-header-frame-inputs'
import { DopesheetRulerHeader } from './dopesheet-ruler-header'
import { DopesheetSheetBody } from './dopesheet-sheet-body'
import { DopesheetInterpolationButtons } from './dopesheet-interpolation-buttons'
import { DopesheetParameterMenu } from './dopesheet-parameter-menu'
import { DopesheetLegendPopover } from './dopesheet-legend-popover'
import { DopesheetViewOptionsMenu } from './dopesheet-view-options-menu'
import { KeyframeTimingStrip } from './keyframe-timing-strip'
import { setPointerCaptureSafely } from './dopesheet-utils'
import {
  arePreviewFramesEqual,
  buildGroupedPropertyRows,
  buildGroupedPropertyStructure,
  getNiceTickStep,
} from './dopesheet-helpers'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import { GroupTimelineCell, PropertyTimelineCell } from './dopesheet-timeline-cells'
import { DopesheetPlayheadLine } from './dopesheet-playhead-line'
import {
  DRAG_THRESHOLD,
  EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
  GROUP_HEADER_HEIGHT,
  MINI_ICON_BUTTON_CLASS,
  MINI_ICON_CLASS,
  PROPERTY_COLUMN_WIDTH,
  SPACIOUS_PROPERTY_COLUMN_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  SNAP_THRESHOLD_PX,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from './dopesheet-constants'
import type {
  DopesheetPropertyGroup,
  DopesheetPropertyRow,
  DragState,
  KeyframeMeta,
  RenderedSheetEntry,
  Viewport,
} from './dopesheet-types'
import { getDopesheetRowControlState } from './row-controls'
import { getPropertyAccordionGroups } from './property-groups'
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils'
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store'
import { clampFrame } from './frame-utils'
import {
  buildSelectionFramePreview as buildSelectionFramePreviewState,
  commitSelectionFramePreview as commitSelectionFramePreviewState,
  duplicateSelectionFramePreview as duplicateSelectionFramePreviewState,
} from './selection-frame-actions'
import {
  buildGroupAddEntries,
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  getRemovableGroupCurrentKeyframes,
  removeSelectionIds,
} from './row-action-helpers'
import {
  getKeyframeGroupLabel,
  getKeyframePropertyLabel,
} from '@/features/keyframes/utils/property-i18n'
import { useCoalescedScrub } from '../use-coalesced-scrub'

interface DopesheetEditorProps {
  /** Shared time viewport when split mode needs synchronized frame zoom/pan */
  frameViewport?: Viewport
  /** Callback when the shared time viewport changes */
  onFrameViewportChange?: (viewport: Viewport) => void
  /** Item ID to show keyframes for */
  itemId: string
  /** Keyframes organized by property */
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  /** Currently selected property (or null to show all) */
  selectedProperty?: AnimatableProperty | null
  /** Selected keyframe IDs */
  selectedKeyframeIds?: Set<string>
  /** Current playhead frame */
  currentFrame?: number
  /** Global timeline frame for the same playhead position */
  globalFrame?: number | null
  /** Absolute timeline frame where the edited item starts (for live playhead) */
  itemFrom?: number
  /** Total duration in frames */
  totalFrames?: number
  /** Timeline FPS used for ruler display */
  fps?: number
  /** Width of the editor */
  width?: number
  /** Height of the editor */
  height?: number
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  /** Callback when bezier handles are moved in graph view */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  /** Callback when selection changes */
  onSelectionChange?: (keyframeIds: Set<string>) => void
  /** Callback when property selection changes */
  onPropertyChange?: (property: AnimatableProperty | null) => void
  /** Callback when a property row becomes the active interaction target */
  onActivePropertyChange?: (property: AnimatableProperty) => void
  /** Callback when playhead is scrubbed (frame is clip-relative) */
  onScrub?: (frame: number) => void
  /** Callback when scrubbing starts */
  onScrubStart?: () => void
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void
  /** Callback to add a keyframe at the current frame */
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  /** Callback to add multiple keyframes in a single batch */
  onAddKeyframes?: (entries: Array<{ property: AnimatableProperty; frame: number }>) => void
  /** Callback to duplicate keyframes to explicit target frames */
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
  /** Current property values at the playhead */
  propertyValues?: Partial<Record<AnimatableProperty, number>>
  /** Callback to commit a property value at the playhead */
  onPropertyValueCommit?: (
    property: AnimatableProperty,
    value: number,
    options?: { allowCreate?: boolean },
  ) => void
  /** Callback to remove selected keyframes */
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  /** Copy selected keyframes */
  onCopyKeyframes?: () => void
  /** Cut selected keyframes */
  onCutKeyframes?: () => void
  /** Paste keyframes from clipboard */
  onPasteKeyframes?: () => void
  /** Whether clipboard currently contains keyframes */
  hasKeyframeClipboard?: boolean
  /** Whether clipboard represents a cut operation */
  isKeyframeClipboardCut?: boolean
  /** Selected interpolation/easing for the current editor selection */
  selectedInterpolation?: EasingType
  /** Available interpolation options */
  interpolationOptions?: ReadonlyArray<{ value: EasingType; label: string }>
  /** Callback when the selection interpolation changes */
  onInterpolationChange?: (easing: EasingType) => void
  /** Disable interpolation control */
  interpolationDisabled?: boolean
  /** Callback to navigate to a keyframe */
  onNavigateToKeyframe?: (frame: number) => void
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[]
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Which visualization to render on the right side. `split` shows both the
   *  sheet body and the curve/graph pane at once (Animate workspace placement),
   *  sharing a single frame viewport and playhead so they cannot desync. */
  visualizationMode?: 'dopesheet' | 'graph' | 'split'
  /** Use the wider property column + value inputs (Animate workspace, where
   *  there is room). Defaults to the compact sidebar sizing. */
  spacious?: boolean
  /** Additional class name */
  className?: string
}

type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_KEYFRAMES: Keyframe[] = []
const EMPTY_STRUCTURE_ROWS: StructureRow[] = []
const EMPTY_FRAME_GROUPS: DopesheetPropertyGroupStructure<StructureRow>['frameGroups'] = []

export const DopesheetEditor = memo(function DopesheetEditor({
  frameViewport,
  onFrameViewportChange,
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  globalFrame = null,
  itemFrom = 0,
  totalFrames = 300,
  fps = 30,
  width = 600,
  height = 260,
  onKeyframeMove,
  onBezierHandleMove,
  onSelectionChange,
  onPropertyChange,
  onActivePropertyChange,
  onScrub,
  onScrubStart,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onAddKeyframe,
  onAddKeyframes,
  onDuplicateKeyframes,
  propertyValues = {},
  onPropertyValueCommit,
  onRemoveKeyframes,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
  hasKeyframeClipboard = false,
  isKeyframeClipboardCut = false,
  selectedInterpolation,
  interpolationOptions = [],
  onInterpolationChange,
  interpolationDisabled = false,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  disabled = false,
  visualizationMode = 'dopesheet',
  spacious = false,
  className,
}: DopesheetEditorProps) {
  const { t } = useTranslation()
  // `split` shows both panes at once. Derive per-pane visibility so the many
  // mode branches below read intent ("is the graph showing?") rather than an
  // exact mode, and the exclusive `dopesheet`/`graph` modes stay unchanged.
  const showSheetPane = visualizationMode !== 'graph'
  const showGraphPane = visualizationMode !== 'dopesheet'
  const isSplitView = visualizationMode === 'split'
  // Wider property column + value inputs when there is room (Animate workspace).
  const columnWidth = spacious ? SPACIOUS_PROPERTY_COLUMN_WIDTH : PROPERTY_COLUMN_WIDTH
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const graphPaneRef = useRef<HTMLDivElement>(null)
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const snapEnabled = true
  const [valueDrafts, setValueDrafts] = useState<Partial<Record<AnimatableProperty, string>>>({})
  const [editingValueProperty, setEditingValueProperty] = useState<AnimatableProperty | null>(null)
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId],
    ),
  )
  const setAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.setAutoKeyframeEnabled)
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled)
  const skipNextBlurCommitPropertyRef = useRef<AnimatableProperty | null>(null)
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null)
  const [sheetPreviewFrames, setSheetPreviewFrames] = useState<Record<string, number> | null>(null)
  const [sheetPreviewDuplicateKeyframeIds, setSheetPreviewDuplicateKeyframeIds] = useState<
    string[] | null
  >(null)

  const { viewport, updateViewport, normalizeViewport, contentFrameMax, minViewportFrames } =
    useDopesheetViewport({
      totalFrames,
      frameViewport,
      onFrameViewportChange,
    })

  const { width: timelineWidth } = useElementSize(timelineRef, { deps: [visualizationMode] })

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty],
  )
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties],
  )
  const propertyGroupIdByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, string>()
    for (const group of allPropertyGroups) {
      for (const property of group.properties) {
        map.set(property, group.id)
      }
    }
    return map
  }, [allPropertyGroups])
  const keyframedPropertyIds = useMemo(
    () =>
      new Set(
        availableProperties.filter((property) => (keyframesByProperty[property] ?? []).length > 0),
      ),
    [availableProperties, keyframesByProperty],
  )
  const {
    graphVisibleProperties,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    graphVerticalZoomValue,
    setGraphVerticalZoomValue,
    togglePropertyCurve,
    toggleGroupCurves,
  } = useGraphViewState({
    itemId,
    availableProperties,
    selectedProperty,
    onPropertyChange,
    onActivePropertyChange,
  })

  const {
    visibleGroups,
    setVisibleGroups,
    showKeyframedOnly,
    setShowKeyframedOnly,
    toggleVisibleGroup,
    isPropertyLocked,
    toggleLockedProperty,
    setGroupLocked,
  } = usePropertyFilters({ allPropertyGroups, availableProperties })

  const filteredProperties = useMemo(
    () =>
      availableProperties.filter((property) => {
        const groupId = propertyGroupIdByProperty.get(property)
        const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true
        if (!groupVisible) return false
        if (showKeyframedOnly && !keyframedPropertyIds.has(property)) return false
        return true
      }),
    [
      availableProperties,
      keyframedPropertyIds,
      propertyGroupIdByProperty,
      showKeyframedOnly,
      visibleGroups,
    ],
  )
  const activeSelectedProperty =
    selectedProperty && filteredProperties.includes(selectedProperty) ? selectedProperty : null
  const visibleProperties = filteredProperties
  const propertyColumnProperties = filteredProperties
  const hasPropertyFilters =
    showKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false)

  // Frame-independent keyframe data. These references only change when the
  // properties or keyframes change — NOT when the playhead moves — so the
  // memoized timeline grid cells can skip re-rendering during scrubs.
  const sheetKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>()
    for (const property of visibleProperties) {
      map.set(
        property,
        (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
      )
    }
    return map
  }, [visibleProperties, keyframesByProperty])

  const sheetRowsStructure = useMemo(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: sheetKeyframesByProperty.get(property) ?? [],
      })),
    [visibleProperties, sheetKeyframesByProperty],
  )

  // Stable, frame-independent group structure keyed by group id — used to feed
  // the memoized group timeline cells.
  const groupTimelineById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildGroupedPropertyStructure>[number]>()
    for (const group of buildGroupedPropertyStructure(sheetRowsStructure)) {
      map.set(group.id, group)
    }
    return map
  }, [sheetRowsStructure])

  // Playhead-dependent rows (carry the per-frame `controls`). `propertyColumnProperties`
  // is the same list as `visibleProperties`, so the column/sheet rows are identical.
  const sheetRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      sheetRowsStructure.map((row) => ({
        ...row,
        controls: getDopesheetRowControlState(row.keyframes, currentFrame),
      })),
    [sheetRowsStructure, currentFrame],
  )

  const propertyRows = sheetRows
  const groupedSheetRows = useMemo(
    () => buildGroupedPropertyRows(sheetRows, currentFrame),
    [currentFrame, sheetRows],
  )
  const groupedPropertyRows = groupedSheetRows
  const propertyRowByProperty = useMemo(
    () => new Map(propertyRows.map((row) => [row.property, row])),
    [propertyRows],
  )
  const { expandedGroups, toggleGroup, setAllGroupsExpanded } = useGroupExpansion({
    allPropertyGroups,
    groupedSheetRows,
    groupedPropertyRows,
    activeSelectedProperty,
  })

  const resetParameterView = useCallback(() => {
    setShowKeyframedOnly(false)
    setVisibleGroups(
      Object.fromEntries(allPropertyGroups.map((group) => [group.id, true])) as Record<
        string,
        boolean
      >,
    )
    setAllGroupsExpanded(true)
  }, [allPropertyGroups, setAllGroupsExpanded, setShowKeyframedOnly, setVisibleGroups])

  const graphPaneSize = useElementSize(graphPaneRef, {
    enabled: showGraphPane,
    deps: [visualizationMode, propertyRows.length],
  })

  const formatPropertyValue = useCallback(
    (property: AnimatableProperty, value: number | undefined) => {
      if (value === undefined || Number.isNaN(value)) return ''
      const decimals = PROPERTY_VALUE_RANGES[property]?.decimals ?? 2
      return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals)
    },
    [],
  )

  useEffect(() => {
    setValueDrafts((prev) => {
      let changed = false
      const nextDrafts = { ...prev }

      for (const property of propertyColumnProperties) {
        if (editingValueProperty === property) continue
        const nextValue = formatPropertyValue(property, propertyValues[property])
        if (nextDrafts[property] !== nextValue) {
          nextDrafts[property] = nextValue
          changed = true
        }
      }

      return changed ? nextDrafts : prev
    })
  }, [propertyColumnProperties, propertyValues, editingValueProperty, formatPropertyValue])
  const rowKeyframesByProperty = sheetKeyframesByProperty

  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe })
      }
    }
    return map
  }, [sheetRowsStructure])

  const keyframeMetaByIdRef = useRef(keyframeMetaById)
  keyframeMetaByIdRef.current = keyframeMetaById

  const selectedFrameSummary = useMemo(() => {
    const selectedFrames: number[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (meta) {
        selectedFrames.push(meta.keyframe.frame)
      }
    }

    if (selectedFrames.length === 0) {
      return {
        hasSelection: false,
        hasMixedFrames: false,
        localFrame: null as number | null,
        globalFrame: null as number | null,
      }
    }

    const firstFrame = selectedFrames[0] ?? null
    const hasMixedFrames = selectedFrames.some((frame) => frame !== firstFrame)
    const frameOffset = globalFrame === null ? null : globalFrame - currentFrame

    return {
      hasSelection: true,
      hasMixedFrames,
      localFrame: hasMixedFrames ? null : firstFrame,
      globalFrame:
        hasMixedFrames || firstFrame === null || frameOffset === null
          ? null
          : firstFrame + frameOffset,
    }
  }, [currentFrame, globalFrame, keyframeMetaById, selectedKeyframeIds])
  const selectedCurveProperty = useMemo(() => {
    let property: AnimatableProperty | null = null

    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) {
        continue
      }

      if (property === null) {
        property = meta.property
        continue
      }

      if (property !== meta.property) {
        return null
      }
    }

    return property
  }, [keyframeMetaById, selectedKeyframeIds])

  useEffect(() => {
    if (!showGraphPane || !selectedCurveProperty) {
      return
    }

    if (selectedProperty !== selectedCurveProperty) {
      onPropertyChange?.(selectedCurveProperty)
    }
    onActivePropertyChange?.(selectedCurveProperty)
  }, [
    onActivePropertyChange,
    onPropertyChange,
    selectedCurveProperty,
    selectedProperty,
    showGraphPane,
  ])

  const visibleKeyframes = useMemo(
    () =>
      sheetRows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        })),
      ),
    [sheetRows],
  )

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const horizontalZoomRatioBase = useMemo(
    () => Math.max(1, contentFrameMax / Math.max(1, minViewportFrames)),
    [contentFrameMax, minViewportFrames],
  )
  const horizontalZoomValue = useMemo(() => {
    if (horizontalZoomRatioBase <= 1) {
      return 0
    }

    const normalized =
      Math.log(contentFrameMax / Math.max(1, frameRange)) / Math.log(horizontalZoomRatioBase)
    return Math.max(0, Math.min(100, normalized * 100))
  }, [contentFrameMax, frameRange, horizontalZoomRatioBase])
  const visibleGraphProperties = useMemo(
    () => [...graphVisibleProperties],
    [graphVisibleProperties],
  )
  const graphBaseValueRange = useMemo(
    () =>
      getCombinedGraphValueRange(
        visibleGraphProperties.map((property) => PROPERTY_VALUE_RANGES[property] ?? null),
        visibleGraphProperties.map((property) => keyframesByProperty[property] ?? []),
        autoZoomGraphHeight,
      ),
    [autoZoomGraphHeight, keyframesByProperty, visibleGraphProperties],
  )
  const graphBaseValueSpan = useMemo(
    () => Math.max(0.0001, graphBaseValueRange.max - graphBaseValueRange.min),
    [graphBaseValueRange],
  )
  const graphMinZoomValueSpan = useMemo(
    () => Math.max(graphBaseValueSpan * 0.02, 0.0001),
    [graphBaseValueSpan],
  )
  const verticalZoomRatioBase = useMemo(
    () => Math.max(1, graphBaseValueSpan / graphMinZoomValueSpan),
    [graphBaseValueSpan, graphMinZoomValueSpan],
  )
  const fallbackTimelineWidth = Math.max(width - columnWidth, 1)
  const effectiveTimelineWidth = Math.max(timelineWidth || fallbackTimelineWidth, 1)
  const timelinePixelsPerSecond = useMemo(
    () => (effectiveTimelineWidth / frameRange) * fps,
    [effectiveTimelineWidth, frameRange, fps],
  )

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )
  const getRenderedKeyframeX = useCallback(
    (frame: number) => getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )
  const setKeyframeButtonRef = useCallback((keyframeId: string, node: HTMLButtonElement | null) => {
    if (node) {
      keyframeButtonRefs.current.set(keyframeId, node)
    } else {
      keyframeButtonRefs.current.delete(keyframeId)
    }
  }, [])
  const applyDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      const previousPreviewFrames = appliedDragPreviewFramesRef.current
      if (arePreviewFramesEqual(previousPreviewFrames, nextPreviewFrames)) {
        return
      }

      const duplicatePreviewIds =
        dragStateRef.current?.duplicateOnCommit && nextPreviewFrames
          ? dragStateRef.current.selectedKeyframeIds
          : null

      flushSync(() => {
        setSheetPreviewFrames(nextPreviewFrames)
        setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds)
      })

      const keyframeIds = new Set([
        ...Object.keys(previousPreviewFrames ?? {}),
        ...Object.keys(nextPreviewFrames ?? {}),
      ])

      if (duplicatePreviewIds) {
        appliedDragPreviewFramesRef.current = nextPreviewFrames
        return
      }

      for (const keyframeId of keyframeIds) {
        const button = keyframeButtonRefs.current.get(keyframeId)
        if (!button) continue

        const previewFrame = nextPreviewFrames?.[keyframeId]
        const frame = previewFrame ?? keyframeMetaByIdRef.current.get(keyframeId)?.keyframe.frame
        if (frame === undefined) continue

        const renderedX = getRenderedKeyframeX(frame)
        if (renderedX === null) {
          button.style.visibility = 'hidden'
          continue
        }

        button.style.left = `${renderedX}px`
        button.style.visibility = 'visible'
      }

      appliedDragPreviewFramesRef.current = nextPreviewFrames
    },
    [getRenderedKeyframeX],
  )
  const scheduleDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      applyDragPreviewFrames(nextPreviewFrames)
    },
    [applyDragPreviewFrames],
  )
  const renderedKeyframeXById = useMemo(() => {
    const positions = new Map<string, number>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        const x = getRenderedKeyframeX(keyframe.frame)
        if (x !== null) {
          positions.set(keyframe.id, x)
        }
      }
    }
    return positions
  }, [sheetRowsStructure, getRenderedKeyframeX])
  const renderedSheetEntries = useMemo(() => {
    const entries: RenderedSheetEntry[] = []
    let top = 0

    for (const group of groupedSheetRows) {
      entries.push({ type: 'group', group, top })
      top += GROUP_HEADER_HEIGHT

      if (!(expandedGroups[group.id] ?? true)) {
        continue
      }

      for (const row of group.rows) {
        entries.push({ type: 'row', row, top })
        top += ROW_HEIGHT
      }
    }

    return {
      entries,
      contentHeight: top,
    }
  }, [expandedGroups, groupedSheetRows])
  const keyframePoints = useMemo(
    () =>
      renderedSheetEntries.entries.flatMap((entry) => {
        if (entry.type === 'group') {
          return entry.group.frameGroups.flatMap((frameGroup) => {
            const x = getRenderedKeyframeX(frameGroup.frame)
            if (x === null) return []

            return frameGroup.keyframes
              .filter(({ property }) => !isPropertyLocked(property))
              .map(({ keyframe }) => ({
                keyframeId: keyframe.id,
                x,
                y: entry.top + GROUP_HEADER_HEIGHT / 2,
              }))
          })
        }

        if (isPropertyLocked(entry.row.property)) {
          return []
        }

        return entry.row.keyframes.flatMap((keyframe) => {
          const x = renderedKeyframeXById.get(keyframe.id)
          if (x === undefined) return []
          return [
            {
              keyframeId: keyframe.id,
              x,
              y: entry.top + ROW_HEIGHT / 2,
            },
          ]
        })
      }),
    [getRenderedKeyframeX, isPropertyLocked, renderedKeyframeXById, renderedSheetEntries.entries],
  )
  const keyframePointsRef = useRef(keyframePoints)
  keyframePointsRef.current = keyframePoints

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return currentFrame
      const rect = node.getBoundingClientRect()
      return clampFrame(xToFrame(clientX - rect.left), totalFrames)
    },
    [xToFrame, totalFrames, currentFrame],
  )

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(0, Math.min(effectiveTimelineWidth, clientX - rect.left))
    },
    [effectiveTimelineWidth],
  )

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const y = clientY - rect.top + node.scrollTop
      const maxY = Math.max(0, renderedSheetEntries.contentHeight)
      return Math.max(0, Math.min(maxY, y))
    },
    [renderedSheetEntries.contentHeight],
  )

  const ticks = useMemo(() => {
    const step = getNiceTickStep(frameRange)
    const first = Math.floor(viewport.startFrame / step) * step
    const result: number[] = []
    for (let frame = first; frame <= viewport.endFrame; frame += step) {
      if (frame >= viewport.startFrame) {
        result.push(frame)
      }
    }
    return result
  }, [viewport.startFrame, viewport.endFrame, frameRange])

  const propertyGridStyle = useMemo(() => {
    return { gridTemplateColumns: `${columnWidth}px 1fr` }
  }, [columnWidth])

  const selectedRefs = useMemo(() => {
    const refs: KeyframeRef[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) continue
      if (isPropertyLocked(meta.property)) continue
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      })
    }
    return refs
  }, [selectedKeyframeIds, keyframeMetaById, isPropertyLocked, itemId])
  const selectedRefIds = useMemo(() => selectedRefs.map((ref) => ref.keyframeId), [selectedRefs])

  const isCurrentFrameBlocked = useMemo(
    () =>
      transitionBlockedRanges.some(
        (range) => currentFrame >= range.start && currentFrame < range.end,
      ),
    [transitionBlockedRanges, currentFrame],
  )

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame]
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame)
      }
    }
    return [...new Set(targets)]
  }, [visibleKeyframes, selectedKeyframeIds, currentFrame])

  const snapThresholdFrames = useMemo(
    () => (SNAP_THRESHOLD_PX / effectiveTimelineWidth) * frameRange,
    [effectiveTimelineWidth, frameRange],
  )

  const snapFrame = useCallback(
    (frame: number) => {
      let closest = frame
      let minDistance = Infinity
      for (const target of snapFrameTargets) {
        const distance = Math.abs(frame - target)
        if (distance <= snapThresholdFrames && distance < minDistance) {
          minDistance = distance
          closest = target
        }
      }
      return closest
    },
    [snapFrameTargets, snapThresholdFrames],
  )

  const zoomAroundFrame = useCallback(
    (centerFrame: number, factor: number) => {
      updateViewport((prev) => {
        const prevRange = Math.max(1, prev.endFrame - prev.startFrame)
        const nextRange = Math.max(
          minViewportFrames,
          Math.min(contentFrameMax, Math.round(prevRange * factor)),
        )
        const ratio = (centerFrame - prev.startFrame) / prevRange
        let nextStart = Math.round(centerFrame - ratio * nextRange)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }
        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [contentFrameMax, minViewportFrames, normalizeViewport, updateViewport],
  )
  const setHorizontalZoomValue = useCallback(
    (nextValue: number) => {
      if (horizontalZoomRatioBase <= 1) {
        return
      }

      const normalized = Math.max(0, Math.min(1, nextValue / 100))
      const nextRange = Math.max(
        minViewportFrames,
        Math.min(
          contentFrameMax,
          Math.round(contentFrameMax / Math.pow(horizontalZoomRatioBase, normalized)),
        ),
      )

      updateViewport((prev) => {
        const centerFrame = (prev.startFrame + prev.endFrame) / 2
        let nextStart = Math.round(centerFrame - nextRange / 2)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }

        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [
      contentFrameMax,
      horizontalZoomRatioBase,
      minViewportFrames,
      normalizeViewport,
      updateViewport,
    ],
  )

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return
      updateViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame)
        const maxStart = Math.max(0, contentFrameMax - range)
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames))
        return normalizeViewport({
          startFrame: nextStart,
          endFrame: nextStart + range,
        })
      })
    },
    [contentFrameMax, normalizeViewport, updateViewport],
  )

  const resetViewport = useCallback(() => {
    updateViewport({ startFrame: 0, endFrame: contentFrameMax })
  }, [contentFrameMax, updateViewport])

  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return
    onRemoveKeyframes(selectedRefs)
  }, [onRemoveKeyframes, selectedRefs])

  const buildSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, requestedDeltaFrames: number) => {
      return buildSelectionFramePreviewState({
        selectionIds,
        requestedDeltaFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        keyframesByProperty,
        totalFrames,
        transitionBlockedRanges,
      })
    },
    [isPropertyLocked, keyframesByProperty, totalFrames, transitionBlockedRanges],
  )

  const commitSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return commitSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onKeyframeMove,
      })
    },
    [isPropertyLocked, itemId, onKeyframeMove],
  )
  const duplicateSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return duplicateSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onDuplicateKeyframes,
      })
    },
    [isPropertyLocked, itemId, onDuplicateKeyframes],
  )

  const canAddKeyframeForRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onAddKeyframe) return false
      if (isPropertyLocked(row.property)) return false
      if (row.controls.hasKeyframeAtCurrentFrame) return false
      if (isCurrentFrameBlocked) return false
      return true
    },
    [disabled, isCurrentFrameBlocked, isPropertyLocked, onAddKeyframe],
  )

  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false
      if (isPropertyLocked(row.property)) return false
      return row.keyframes.length > 0
    },
    [disabled, isPropertyLocked, onRemoveKeyframes],
  )

  const moveSelectedKeyframesByDelta = useCallback(
    (deltaFrames: number) => {
      if (disabled || !onKeyframeMove || selectedRefIds.length === 0 || deltaFrames === 0) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      const preview = buildSelectionFramePreview(selectedRefIds, deltaFrames)
      if (!preview.previewFrames) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      onDragStart?.()
      const didMove = commitSelectionFramePreview(
        preview.movableSelectionIds,
        preview.previewFrames,
      )
      onDragEnd?.()

      return {
        didMove,
        appliedDeltaFrames: preview.appliedDeltaFrames,
      }
    },
    [
      buildSelectionFramePreview,
      commitSelectionFramePreview,
      disabled,
      onDragEnd,
      onDragStart,
      onKeyframeMove,
      selectedRefIds,
    ],
  )

  const {
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  } = useHeaderFrameInputs({
    selectedFrameSummary,
    currentFrame,
    globalFrame,
    totalFrames,
    transitionBlockedRanges,
    onKeyframeMove,
    onNavigateToKeyframe,
    moveSelectedKeyframesByDelta,
  })

  const activateProperty = useCallback(
    (property: AnimatableProperty) => {
      if (showGraphPane) {
        onPropertyChange?.(property)
      }
      onActivePropertyChange?.(property)
    },
    [onActivePropertyChange, onPropertyChange, showGraphPane],
  )

  const removeKeyframesForRows = useCallback(
    (rows: DopesheetPropertyRow[]) => {
      if (!onRemoveKeyframes) return

      const refs = buildRowKeyframeRefs(itemId, rows)

      if (refs.length === 0) return

      onRemoveKeyframes(refs)

      if (onSelectionChange) {
        onSelectionChange(
          removeSelectionIds(
            selectedKeyframeIds,
            refs.map((ref) => ref.keyframeId),
          ),
        )
      }
    },
    [itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds],
  )

  const handleClearProperty = useCallback(
    (property: AnimatableProperty) => {
      const row = propertyRowByProperty.get(property)
      if (!row || !canClearRow(row)) return

      activateProperty(property)
      removeKeyframesForRows([row])
    },
    [activateProperty, canClearRow, propertyRowByProperty, removeKeyframesForRows],
  )

  const handleAddGroupKeyframes = useCallback(
    (group: DopesheetPropertyGroup) => {
      if (disabled || (!onAddKeyframe && !onAddKeyframes)) return

      const entries = buildGroupAddEntries(group.rows, currentFrame, canAddKeyframeForRow)

      if (entries.length === 0) {
        return
      }

      if (onAddKeyframes) {
        onAddKeyframes(entries)
        return
      }

      for (const entry of entries) {
        onAddKeyframe?.(entry.property, entry.frame)
      }
    },
    [canAddKeyframeForRow, currentFrame, disabled, onAddKeyframe, onAddKeyframes],
  )

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)))
    },
    [canClearRow, removeKeyframesForRows],
  )

  const handleGroupToggleKeyframes = useCallback(
    (group: DopesheetPropertyGroup) => {
      const removableCurrentKeyframes = getRemovableGroupCurrentKeyframes(
        group.currentKeyframes,
        isPropertyLocked,
      )

      if (removableCurrentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return

        const refs = removableCurrentKeyframes.map(({ property, keyframe }) => ({
          itemId,
          property,
          keyframeId: keyframe.id,
        }))
        onRemoveKeyframes(refs)

        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              removableCurrentKeyframes.map(({ keyframe }) => keyframe.id),
            ),
          )
        }
        return
      }

      handleAddGroupKeyframes(group)
    },
    [
      handleAddGroupKeyframes,
      isPropertyLocked,
      itemId,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
    ],
  )

  const handleRowNavigate = useCallback(
    (property: AnimatableProperty, keyframe: Keyframe | null) => {
      if (!keyframe || !onNavigateToKeyframe) return
      activateProperty(property)
      onNavigateToKeyframe(keyframe.frame)
      onSelectionChange?.(new Set([keyframe.id]))
      selectionAnchorByPropertyRef.current.set(property, keyframe.id)
    },
    [activateProperty, onNavigateToKeyframe, onSelectionChange],
  )

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return
        const refs = buildPropertyKeyframeRefs(itemId, property, currentKeyframes)
        onRemoveKeyframes(refs)
        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              currentKeyframes.map((keyframe) => keyframe.id),
            ),
          )
        }
        return
      }

      if (isCurrentFrameBlocked || !onAddKeyframe) return
      onAddKeyframe(property, currentFrame)
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ],
  )

  const handleRowValueChange = useCallback((property: AnimatableProperty, value: string) => {
    setValueDrafts((prev) => ({ ...prev, [property]: value }))
  }, [])

  const handleRowAutoKeyToggle = useCallback(
    (property: AnimatableProperty) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      toggleAutoKeyframeEnabled(itemId, property)
    },
    [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled],
  )

  const handleGroupAutoKeyToggle = useCallback(
    (group: DopesheetPropertyGroup) => {
      const eligibleRows = group.rows.filter((row) => !isPropertyLocked(row.property))
      if (eligibleRows.length === 0) return

      const enableAll = !eligibleRows.every(
        (row) => autoKeyEnabledByProperty[row.property] ?? false,
      )
      for (const row of eligibleRows) {
        setAutoKeyframeEnabled(itemId, row.property, enableAll)
      }
    },
    [autoKeyEnabledByProperty, isPropertyLocked, itemId, setAutoKeyframeEnabled],
  )

  const handleRowValueCommit = useCallback(
    (property: AnimatableProperty, options?: { allowCreate?: boolean }) => {
      if (isPropertyLocked(property)) return
      const range = PROPERTY_VALUE_RANGES[property]
      const parsed = Number(valueDrafts[property])

      if (!Number.isFinite(parsed)) {
        setValueDrafts((prev) => ({
          ...prev,
          [property]: formatPropertyValue(property, propertyValues[property]),
        }))
        return
      }

      const clampedValue = Math.max(range?.min ?? parsed, Math.min(range?.max ?? parsed, parsed))
      onPropertyValueCommit?.(property, clampedValue, options)
      setValueDrafts((prev) => ({
        ...prev,
        [property]: formatPropertyValue(property, clampedValue),
      }))
    },
    [formatPropertyValue, isPropertyLocked, onPropertyValueCommit, propertyValues, valueDrafts],
  )

  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames)
    },
    [moveSelectedKeyframesByDelta],
  )

  useHotkeys(
    'delete,backspace',
    (event) => {
      event.preventDefault()
      if (selectedRefs.length > 0) {
        onRemoveKeyframes?.(selectedRefs)
      }
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs, onRemoveKeyframes],
  )

  useHotkeys(
    'left',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(-1)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'right',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(1)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+left',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(-10)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+right',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(10)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  const dragStateRef = useRef<DragState | null>(null)
  const selectionAnchorByPropertyRef = useRef(new Map<AnimatableProperty, string>())

  const {
    marqueeRect,
    marqueeJustEndedRef,
    getMarqueeModeFromPointerEvent,
    beginMarqueeSelection,
  } = useDopesheetMarquee({
    keyframePointsRef,
    scrollAreaRef,
    getTimelineXFromClientX,
    getContentYFromClientY,
    onSelectionChange,
  })

  const handleKeyframePointerDown = useCallback(
    (
      property: AnimatableProperty,
      keyframeId: string,
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const propertyKeyframes = rowKeyframesByProperty.get(property) ?? []
        const clickedIndex = propertyKeyframes.findIndex((keyframe) => keyframe.id === keyframeId)
        const anchorId = selectionAnchorByPropertyRef.current.get(property)
        const anchorIndex = anchorId
          ? propertyKeyframes.findIndex((keyframe) => keyframe.id === anchorId)
          : -1

        const nextSelection = new Set(selectedKeyframeIds)
        if (clickedIndex >= 0 && anchorIndex >= 0) {
          const start = Math.min(clickedIndex, anchorIndex)
          const end = Math.max(clickedIndex, anchorIndex)
          for (let i = start; i <= end; i++) {
            const keyframe = propertyKeyframes[i]
            if (keyframe) nextSelection.add(keyframe.id)
          }
        } else {
          nextSelection.add(keyframeId)
        }
        onSelectionChange?.(nextSelection)
        selectionAnchorByPropertyRef.current.set(property, keyframeId)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds)
        if (nextSelection.has(keyframeId)) {
          nextSelection.delete(keyframeId)
        } else {
          nextSelection.add(keyframeId)
        }
        onSelectionChange?.(nextSelection)
        selectionAnchorByPropertyRef.current.set(property, keyframeId)
        return
      }

      const baseSelection = selectedKeyframeIds.has(keyframeId)
        ? new Set(selectedKeyframeIds)
        : new Set([keyframeId])

      if (!selectedKeyframeIds.has(keyframeId)) {
        onSelectionChange?.(baseSelection)
      }
      selectionAnchorByPropertyRef.current.set(property, keyframeId)

      const selectedIdsForDrag =
        baseSelection.has(keyframeId) && baseSelection.size > 1
          ? Array.from(baseSelection)
          : [keyframeId]

      const initialFrames = new Map<string, number>()
      for (const id of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(id)
        if (!meta) continue
        initialFrames.set(id, meta.keyframe.frame)
      }

      dragStateRef.current = {
        anchorKeyframeId: keyframeId,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      }
      scheduleDragPreviewFrames(null)

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      rowKeyframesByProperty,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      onSelectionChange,
    ],
  )
  const handleGroupKeyframePointerDown = useCallback(
    (
      frameGroup: DopesheetPropertyGroup['frameGroups'][number],
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return
      if (event.button !== 0) return

      const movableEntries = frameGroup.keyframes.filter(
        ({ property }) => !isPropertyLocked(property),
      )
      if (movableEntries.length === 0) return

      event.preventDefault()
      event.stopPropagation()

      const keyframeIds = movableEntries.map(({ keyframe }) => keyframe.id)
      const anchorEntry = movableEntries[0]
      if (!anchorEntry) return

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        onSelectionChange?.(new Set([...selectedKeyframeIds, ...keyframeIds]))
        return
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds)
        for (const keyframeId of keyframeIds) {
          if (nextSelection.has(keyframeId)) {
            nextSelection.delete(keyframeId)
          } else {
            nextSelection.add(keyframeId)
          }
        }
        onSelectionChange?.(nextSelection)
        return
      }

      const allSelected = keyframeIds.every((keyframeId) => selectedKeyframeIds.has(keyframeId))
      const baseSelection = allSelected ? new Set(selectedKeyframeIds) : new Set(keyframeIds)
      if (!allSelected) {
        onSelectionChange?.(baseSelection)
      }
      onActivePropertyChange?.(anchorEntry.property)
      for (const { property, keyframe } of movableEntries) {
        selectionAnchorByPropertyRef.current.set(property, keyframe.id)
      }

      const selectedIdsForDrag =
        allSelected && baseSelection.size > keyframeIds.length
          ? Array.from(baseSelection)
          : keyframeIds
      const initialFrames = new Map<string, number>()
      for (const keyframeId of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(keyframeId)
        if (!meta) continue
        initialFrames.set(keyframeId, meta.keyframe.frame)
      }

      dragStateRef.current = {
        anchorKeyframeId: anchorEntry.keyframe.id,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      }
      scheduleDragPreviewFrames(null)

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      onSelectionChange,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
    ],
  )
  const handleRowPointerDown = useCallback(
    (property: AnimatableProperty, event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      beginMarqueeSelection,
      disabled,
      getMarqueeModeFromPointerEvent,
      isPropertyLocked,
      onActivePropertyChange,
      selectedKeyframeIds,
    ],
  )

  const handleTimelineBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, selectedKeyframeIds],
  )

  useEffect(() => {
    if (!onKeyframeMove && !onDuplicateKeyframes) return

    const handlePointerMove = (event: PointerEvent) => {
      if (disabled) return
      const dragState = dragStateRef.current
      if (!dragState) return
      if (dragState.pointerId !== event.pointerId) return

      const deltaX = event.clientX - dragState.startClientX
      if (!dragState.started && Math.abs(deltaX) > DRAG_THRESHOLD) {
        dragState.started = true
        if (!dragState.duplicateOnCommit) {
          onDragStart?.()
        }
      }

      if (!dragState.started) return

      const deltaFramesRaw = (deltaX / effectiveTimelineWidth) * frameRange
      let deltaFrames = Math.round(deltaFramesRaw)

      if (snapEnabled && !event.ctrlKey && !event.metaKey) {
        const anchorInitialFrame = dragState.initialFrames.get(dragState.anchorKeyframeId)
        if (anchorInitialFrame !== undefined) {
          const anchorCandidate = clampFrame(anchorInitialFrame + deltaFrames, totalFrames)
          const snappedAnchor = snapFrame(anchorCandidate)
          deltaFrames += snappedAnchor - anchorCandidate
        }
      }

      const preview = buildSelectionFramePreview(dragState.selectedKeyframeIds, deltaFrames)
      scheduleDragPreviewFrames(preview.previewFrames)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      if (dragState.started) {
        const previewFrames = appliedDragPreviewFramesRef.current
        if (dragState.duplicateOnCommit) {
          duplicateSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames)
        } else {
          commitSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames)
          onDragEnd?.()
        }
      }
      dragStateRef.current = null
      scheduleDragPreviewFrames(null)
    }

    return addWindowPointerListeners(handlePointerMove, handlePointerUp)
  }, [
    disabled,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    onKeyframeMove,
    onDuplicateKeyframes,
    onDragStart,
    onDragEnd,
    effectiveTimelineWidth,
    frameRange,
    totalFrames,
    snapEnabled,
    snapFrame,
    scheduleDragPreviewFrames,
  ])

  const scrubPointerIdRef = useRef<number | null>(null)
  const lastScrubbedFrameRef = useRef<number | null>(null)
  const {
    startScrub: startRulerScrub,
    queueScrub: queueRulerScrub,
    flushPendingScrub: flushPendingRulerScrub,
  } = useCoalescedScrub(onScrub)
  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      scrubPointerIdRef.current = event.pointerId
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
      const frame = getFrameFromClientX(event.clientX)
      lastScrubbedFrameRef.current = frame
      onScrubStart?.()
      startRulerScrub({
        frame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
    },
    [
      disabled,
      getFrameFromClientX,
      getTimelineXFromClientX,
      onScrubStart,
      startRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  const handleRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (scrubPointerIdRef.current !== event.pointerId) return
      const frame = getFrameFromClientX(event.clientX)
      if (frame === lastScrubbedFrameRef.current) return
      lastScrubbedFrameRef.current = frame
      queueRulerScrub({
        frame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
    },
    [
      disabled,
      getFrameFromClientX,
      getTimelineXFromClientX,
      queueRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  const handleRulerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scrubPointerIdRef.current !== event.pointerId) return
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors
      }
      scrubPointerIdRef.current = null
      lastScrubbedFrameRef.current = null
      flushPendingRulerScrub(true)
      onScrubEnd?.()
    },
    [flushPendingRulerScrub, onScrubEnd],
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const pivotFrame = getFrameFromClientX(event.clientX)
        if (event.deltaY > 0) {
          zoomAroundFrame(pivotFrame, ZOOM_OUT_FACTOR)
        } else {
          zoomAroundFrame(pivotFrame, ZOOM_IN_FACTOR)
        }
        return
      }

      const deltaFrames = Math.round((event.deltaY / effectiveTimelineWidth) * frameRange)
      panFrames(deltaFrames)
    },
    [disabled, getFrameFromClientX, zoomAroundFrame, panFrames, effectiveTimelineWidth, frameRange],
  )

  // Split-view sheet wheel. The two panes share one horizontal time axis but
  // scroll differently on the vertical axis: the sheet scrolls property rows,
  // the graph zooms its value axis. So over the sheet a plain vertical wheel
  // must scroll rows (not hijack the shared time axis), while time zoom/pan
  // stays reachable via Ctrl (zoom) and horizontal intent (Shift / trackpad
  // swipe). Only when the rows can't travel further do we fall back to panning
  // time, so the gesture never dead-ends.
  const handleSplitSheetWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const pivotFrame = getFrameFromClientX(event.clientX)
        zoomAroundFrame(pivotFrame, event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR)
        return
      }

      const horizontalDelta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
      if (horizontalDelta !== 0) {
        event.preventDefault()
        panFrames(Math.round((horizontalDelta / effectiveTimelineWidth) * frameRange))
        return
      }

      const node = scrollAreaRef.current
      if (node && node.scrollHeight > node.clientHeight + 1) {
        const atTop = node.scrollTop <= 0
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1
        const pastBound = (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)
        if (!pastBound) {
          // Let the inner overflow-auto scroll the rows natively.
          return
        }
      }

      event.preventDefault()
      panFrames(Math.round((event.deltaY / effectiveTimelineWidth) * frameRange))
    },
    [disabled, getFrameFromClientX, zoomAroundFrame, panFrames, effectiveTimelineWidth, frameRange],
  )

  const graphDisplayProperty = useMemo(() => {
    if (graphVisibleProperties.size === 0) return null
    if (activeSelectedProperty && graphVisibleProperties.has(activeSelectedProperty)) {
      return activeSelectedProperty
    }
    return null
  }, [activeSelectedProperty, graphVisibleProperties])
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false
  const focusGraphPane = useCallback(() => {
    graphPaneRef.current?.focus()
  }, [])
  const handleGraphPaneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || graphDisplayPropertyLocked || selectedRefs.length === 0) {
        return
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey

      if (!hasModifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (!onRemoveKeyframes) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRemoveKeyframes(selectedRefs)
        return
      }

      if (!hasModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        event.stopPropagation()
        nudgeSelectedKeyframes(
          event.key === 'ArrowLeft' ? (event.shiftKey ? -10 : -1) : event.shiftKey ? 10 : 1,
        )
      }
    },
    [disabled, graphDisplayPropertyLocked, nudgeSelectedKeyframes, onRemoveKeyframes, selectedRefs],
  )
  const timingStripMarkers = useMemo(() => {
    if (showGraphPane) {
      if (!activeSelectedProperty) {
        return []
      }

      return (keyframesByProperty[activeSelectedProperty] ?? []).map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: selectedKeyframeIds.has(keyframe.id),
        draggable: !!onKeyframeMove && selectedRefIds.includes(keyframe.id),
      }))
    }

    return visibleKeyframes
      .filter(({ keyframe }) => selectedKeyframeIds.has(keyframe.id))
      .map(({ property, keyframe }) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: true,
        draggable: !!onKeyframeMove && !isPropertyLocked(property),
      }))
  }, [
    activeSelectedProperty,
    isPropertyLocked,
    keyframesByProperty,
    onKeyframeMove,
    selectedKeyframeIds,
    selectedRefIds,
    visibleKeyframes,
    showGraphPane,
  ])
  const constrainGraphFrameDelta = useCallback(
    (deltaFrames: number, draggedKeyframeIds: string[]) =>
      constrainSelectedKeyframeDelta({
        keyframesByProperty,
        selectedKeyframeIds: new Set(draggedKeyframeIds),
        totalFrames,
        deltaFrames,
      }),
    [keyframesByProperty, totalFrames],
  )
  const {
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  } = useTimingStripDrag({
    disabled,
    onKeyframeMove,
    onSelectionChange,
    onDragStart,
    onDragEnd,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
  })

  // Mirror timing-strip preview into the sheet drag preview. The sheet shows in
  // both `dopesheet` and `split`, so mirror whenever the sheet pane is visible.
  useEffect(() => {
    if (!showSheetPane) {
      scheduleDragPreviewFrames(null)
      return
    }

    scheduleDragPreviewFrames(timingStripPreviewFrames)
  }, [scheduleDragPreviewFrames, timingStripPreviewFrames, showSheetPane])
  const formatRulerTick = useCallback(
    (frame: number): string => {
      if (graphRulerUnit === 'frames' || !fps || fps <= 0) {
        return String(frame)
      }
      const seconds = frame / fps
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60)
        const remainder = seconds - minutes * 60
        return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
      }
      return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
    },
    [graphRulerUnit, fps],
  )

  const rulerTickElements = useMemo(
    () =>
      ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: frameToX(frame) }}
        >
          <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
            {formatRulerTick(frame)}
          </span>
        </div>
      )),
    [ticks, frameToX, formatRulerTick],
  )
  const renderPropertyRowContent = useCallback(
    (row: DopesheetPropertyRow, options?: { indented?: boolean }) => {
      const rowLocked = isPropertyLocked(row.property)
      const curveVisible = graphVisibleProperties.has(row.property)
      const rowLabel = getKeyframePropertyLabel(t, row.property)
      const showLeftClusterAtRest =
        (autoKeyEnabledByProperty[row.property] ?? false) || rowLocked || curveVisible

      return (
        <div
          className={cn(
            'group h-full px-1 flex items-center gap-px bg-muted/8',
            // Indent child property rows under their group header and draw a
            // faint vertical spine so the column reads as a tree.
            options?.indented &&
              "relative pl-6 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/40 before:content-['']",
            row.controls.hasKeyframeAtCurrentFrame && 'bg-primary/10',
            showGraphPane && graphVisibleProperties.has(row.property) && 'bg-accent/40',
            showGraphPane && !rowLocked && 'cursor-pointer',
            rowLocked && 'opacity-70',
          )}
          onClick={showGraphPane && !rowLocked ? () => activateProperty(row.property) : undefined}
        >
          <div
            className={cn(
              'flex items-center gap-px self-stretch',
              !showLeftClusterAtRest &&
                'opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible
                  ? 'text-orange-500 hover:text-orange-400'
                  : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                togglePropertyCurve(row.property)
              }}
              title={t('timeline.keyframeEditor.showPropertyCurve', {
                property: rowLabel,
                defaultValue: `Show ${rowLabel} curve`,
              })}
              aria-label={t('timeline.keyframeEditor.showPropertyCurve', {
                property: rowLabel,
                defaultValue: `Show ${rowLabel} curve`,
              })}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                rowLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                toggleLockedProperty(row.property)
              }}
              title={
                rowLocked
                  ? t('timeline.keyframeEditor.unlockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Unlock ${rowLabel} row`,
                    })
                  : t('timeline.keyframeEditor.lockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Lock ${rowLabel} row`,
                    })
              }
              aria-label={
                rowLocked
                  ? t('timeline.keyframeEditor.unlockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Unlock ${rowLabel} row`,
                    })
                  : t('timeline.keyframeEditor.lockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Lock ${rowLabel} row`,
                    })
              }
              aria-pressed={rowLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                autoKeyEnabledByProperty[row.property] &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
              )}
              onClick={() => handleRowAutoKeyToggle(row.property)}
              disabled={disabled || rowLocked || !onPropertyValueCommit}
              title={
                autoKeyEnabledByProperty[row.property]
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: rowLabel,
                      defaultValue: `Auto-key enabled for ${rowLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: rowLabel,
                      defaultValue: `Enable auto-key for ${rowLabel}`,
                    })
              }
              aria-label={
                autoKeyEnabledByProperty[row.property]
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: rowLabel,
                      defaultValue: `Auto-key enabled for ${rowLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: rowLabel,
                      defaultValue: `Enable auto-key for ${rowLabel}`,
                    })
              }
              aria-pressed={autoKeyEnabledByProperty[row.property] ?? false}
            >
              <Timer className={MINI_ICON_CLASS} />
            </Button>
          </div>
          <div className="flex h-full min-w-0 flex-1 items-center truncate pl-[10px] pr-1 text-[9px] font-medium leading-none text-foreground/90">
            {rowLabel}
          </div>
          <div className="ml-auto flex items-center gap-0">
            <Input
              type="number"
              value={valueDrafts[row.property] ?? ''}
              onChange={(event) => handleRowValueChange(row.property, event.target.value)}
              onFocus={() => {
                activateProperty(row.property)
                setEditingValueProperty(row.property)
              }}
              onBlur={() => {
                if (skipNextBlurCommitPropertyRef.current === row.property) {
                  skipNextBlurCommitPropertyRef.current = null
                } else {
                  handleRowValueCommit(row.property, {
                    allowCreate: autoKeyEnabledByProperty[row.property] ?? false,
                  })
                }
                setEditingValueProperty((current) => (current === row.property ? null : current))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  skipNextBlurCommitPropertyRef.current = row.property
                  handleRowValueCommit(row.property, { allowCreate: true })
                  setEditingValueProperty((current) => (current === row.property ? null : current))
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  skipNextBlurCommitPropertyRef.current = row.property
                  setValueDrafts((prev) => ({
                    ...prev,
                    [row.property]: formatPropertyValue(row.property, propertyValues[row.property]),
                  }))
                  setEditingValueProperty((current) => (current === row.property ? null : current))
                  event.currentTarget.blur()
                }
              }}
              step={(PROPERTY_VALUE_RANGES[row.property]?.decimals ?? 2) === 0 ? 1 : 0.1}
              min={PROPERTY_VALUE_RANGES[row.property]?.min}
              max={PROPERTY_VALUE_RANGES[row.property]?.max}
              inputMode="decimal"
              className={cn(
                'h-[18px] border-border/70 bg-background/85 px-1 py-0 text-right text-[9px] leading-none tabular-nums md:text-[9px]',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                spacious ? 'w-[64px]' : 'w-[44px]',
              )}
              disabled={
                disabled ||
                rowLocked ||
                !onPropertyValueCommit ||
                (!row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked)
              }
              aria-label={t('timeline.keyframeEditor.propertyValueAtPlayhead', {
                property: rowLabel,
                defaultValue: `${rowLabel} value at playhead`,
              })}
            />
            <div className="flex items-center gap-0 rounded-sm border border-border/70 bg-background/85 px-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
                onClick={() => handleRowNavigate(row.property, row.controls.prevKeyframe)}
                disabled={disabled || row.controls.prevKeyframe === null || !onNavigateToKeyframe}
                title={t('timeline.keyframeEditor.previousPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Previous ${rowLabel} keyframe`,
                })}
                aria-label={t('timeline.keyframeEditor.previousPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Previous ${rowLabel} keyframe`,
                })}
              >
                <ChevronLeft className="h-[9px] w-[9px]" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-4 w-4 p-0 hover:bg-transparent',
                  row.controls.hasKeyframeAtCurrentFrame
                    ? 'text-neutral-200 hover:text-neutral-200'
                    : 'text-muted-foreground hover:text-foreground',
                  isCurrentFrameBlocked &&
                    !row.controls.hasKeyframeAtCurrentFrame &&
                    'opacity-40 cursor-not-allowed',
                )}
                onClick={() => handleRowToggleKeyframe(row.property, row.controls.currentKeyframes)}
                disabled={
                  disabled ||
                  rowLocked ||
                  (!row.controls.hasKeyframeAtCurrentFrame &&
                    (isCurrentFrameBlocked || !onAddKeyframe))
                }
                title={
                  row.controls.hasKeyframeAtCurrentFrame
                    ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                        property: rowLabel,
                        defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                      })
                    : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                        property: rowLabel,
                        defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                      })
                }
                aria-label={
                  row.controls.hasKeyframeAtCurrentFrame
                    ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                        property: rowLabel,
                        defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                      })
                    : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                        property: rowLabel,
                        defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                      })
                }
              >
                <span
                  className={cn(
                    'block h-[7px] w-[7px] rotate-45 border transition-colors',
                    row.controls.hasKeyframeAtCurrentFrame
                      ? 'border-neutral-200 bg-neutral-200'
                      : 'border-current bg-transparent',
                  )}
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
                onClick={() => handleRowNavigate(row.property, row.controls.nextKeyframe)}
                disabled={disabled || row.controls.nextKeyframe === null || !onNavigateToKeyframe}
                title={t('timeline.keyframeEditor.nextPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Next ${rowLabel} keyframe`,
                })}
                aria-label={t('timeline.keyframeEditor.nextPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Next ${rowLabel} keyframe`,
                })}
              >
                <ChevronRight className="h-[9px] w-[9px]" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
              onClick={(event) => {
                event.stopPropagation()
                handleClearProperty(row.property)
              }}
              disabled={!canClearRow(row)}
              title={t('timeline.keyframeEditor.clearPropertyKeyframes', {
                property: rowLabel,
                defaultValue: `Clear ${rowLabel} keyframes`,
              })}
              aria-label={t('timeline.keyframeEditor.clearPropertyKeyframes', {
                property: rowLabel,
                defaultValue: `Clear ${rowLabel} keyframes`,
              })}
            >
              <X className="h-[9px] w-[9px]" />
            </Button>
          </div>
        </div>
      )
    },
    [
      activateProperty,
      canClearRow,
      autoKeyEnabledByProperty,
      disabled,
      formatPropertyValue,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onPropertyValueCommit,
      propertyValues,
      t,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDrafts,
      showGraphPane,
      spacious,
    ],
  )
  const renderGroupHeaderContent = useCallback(
    (group: DopesheetPropertyGroup) => {
      const groupLabel = getKeyframeGroupLabel(t, group.id, group.label)
      const groupProperties = group.rows.map((row) => row.property)
      const curveVisible = groupProperties.some((p) => graphVisibleProperties.has(p))
      const allRowsLocked =
        group.rows.length > 0 && group.rows.every((row) => isPropertyLocked(row.property))
      const unlockedRows = group.rows.filter((row) => !isPropertyLocked(row.property))
      const groupAutoKeyEnabled =
        unlockedRows.length > 0 &&
        unlockedRows.every((row) => autoKeyEnabledByProperty[row.property] ?? false)
      const canAddAny = group.rows.some((row) => canAddKeyframeForRow(row))
      const canClearAny = group.rows.some((row) => canClearRow(row))
      const isOpen = expandedGroups[group.id] ?? true
      const unlockedCurrentKeyframes = group.currentKeyframes.filter(
        ({ property }) => !isPropertyLocked(property),
      )
      const hasUnlockedCurrentKeyframes = unlockedCurrentKeyframes.length > 0
      const canToggleCurrentFrame = hasUnlockedCurrentKeyframes ? !!onRemoveKeyframes : canAddAny

      const showGroupLeftClusterAtRest = curveVisible || allRowsLocked || groupAutoKeyEnabled

      return (
        <div className="group flex h-full items-center gap-px border-y border-border/60 bg-muted/70 pl-3 pr-0.5">
          <div
            className={cn(
              'flex items-center gap-px self-stretch',
              !showGroupLeftClusterAtRest &&
                'opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible
                  ? 'text-orange-500 hover:text-orange-400'
                  : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                toggleGroupCurves(groupProperties)
              }}
              disabled={groupProperties.length === 0}
              title={t('timeline.keyframeEditor.showAllGroupCurves', {
                group: groupLabel,
                defaultValue: `Show all ${groupLabel} curves`,
              })}
              aria-label={t('timeline.keyframeEditor.showAllGroupCurves', {
                group: groupLabel,
                defaultValue: `Show all ${groupLabel} curves`,
              })}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                allRowsLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                setGroupLocked(groupProperties, !allRowsLocked)
              }}
              disabled={groupProperties.length === 0}
              title={
                allRowsLocked
                  ? t('timeline.keyframeEditor.unlockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Unlock ${groupLabel} rows`,
                    })
                  : t('timeline.keyframeEditor.lockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Lock ${groupLabel} rows`,
                    })
              }
              aria-label={
                allRowsLocked
                  ? t('timeline.keyframeEditor.unlockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Unlock ${groupLabel} rows`,
                    })
                  : t('timeline.keyframeEditor.lockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Lock ${groupLabel} rows`,
                    })
              }
              aria-pressed={allRowsLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                groupAutoKeyEnabled &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
              )}
              onClick={(event) => {
                event.stopPropagation()
                handleGroupAutoKeyToggle(group)
              }}
              disabled={disabled || unlockedRows.length === 0 || !onPropertyValueCommit}
              title={
                groupAutoKeyEnabled
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: groupLabel,
                      defaultValue: `Auto-key enabled for ${groupLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: groupLabel,
                      defaultValue: `Enable auto-key for ${groupLabel}`,
                    })
              }
              aria-label={
                groupAutoKeyEnabled
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: groupLabel,
                      defaultValue: `Auto-key enabled for ${groupLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: groupLabel,
                      defaultValue: `Enable auto-key for ${groupLabel}`,
                    })
              }
              aria-pressed={groupAutoKeyEnabled}
            >
              <Timer className={MINI_ICON_CLASS} />
            </Button>
          </div>
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-px rounded-sm px-0 text-left leading-none transition-colors hover:bg-background/40"
            onClick={() => toggleGroup(group.id)}
            aria-expanded={isOpen}
            aria-label={
              isOpen
                ? t('timeline.keyframeEditor.collapseGroup', {
                    group: groupLabel,
                    defaultValue: `Collapse ${groupLabel}`,
                  })
                : t('timeline.keyframeEditor.expandGroup', {
                    group: groupLabel,
                    defaultValue: `Expand ${groupLabel}`,
                  })
            }
          >
            {isOpen ? (
              <ChevronDown
                className={cn(
                  MINI_ICON_CLASS,
                  'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
                )}
              />
            ) : (
              <ChevronRight
                className={cn(
                  MINI_ICON_CLASS,
                  'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
                )}
              />
            )}
            <span className="truncate pl-px text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-foreground">
              {groupLabel}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-0 rounded-sm border border-border/70 bg-background/90 px-px shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'text-muted-foreground hover:text-foreground',
                'opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
              )}
              onClick={(event) => {
                event.stopPropagation()
                handleRowNavigate(
                  group.prevKeyframe?.property ?? group.rows[0]?.property ?? 'x',
                  group.prevKeyframe?.keyframe ?? null,
                )
              }}
              disabled={disabled || group.prevKeyframe === null || !onNavigateToKeyframe}
              title={t('timeline.keyframeEditor.previousGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Previous ${groupLabel} keyframe`,
              })}
              aria-label={t('timeline.keyframeEditor.previousGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Previous ${groupLabel} keyframe`,
              })}
            >
              <ChevronLeft className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'hover:bg-transparent',
                group.hasKeyframeAtCurrentFrame
                  ? 'text-neutral-200 hover:text-neutral-200'
                  : 'text-muted-foreground hover:text-foreground',
                isCurrentFrameBlocked &&
                  !group.hasKeyframeAtCurrentFrame &&
                  'opacity-40 cursor-not-allowed',
              )}
              onClick={(event) => {
                event.stopPropagation()
                handleGroupToggleKeyframes(group)
              }}
              disabled={!canToggleCurrentFrame}
              title={
                hasUnlockedCurrentKeyframes
                  ? t('timeline.keyframeEditor.removeGroupKeyframesAtPlayhead', {
                      group: groupLabel,
                      defaultValue: `Remove ${groupLabel} keyframes at playhead`,
                    })
                  : t('timeline.keyframeEditor.toggleGroupKeyframesAtPlayhead', {
                      group: groupLabel,
                      defaultValue: `Toggle ${groupLabel} keyframes at playhead`,
                    })
              }
              aria-label={
                hasUnlockedCurrentKeyframes
                  ? t('timeline.keyframeEditor.removeGroupKeyframesAtPlayhead', {
                      group: groupLabel,
                      defaultValue: `Remove ${groupLabel} keyframes at playhead`,
                    })
                  : t('timeline.keyframeEditor.toggleGroupKeyframesAtPlayhead', {
                      group: groupLabel,
                      defaultValue: `Toggle ${groupLabel} keyframes at playhead`,
                    })
              }
            >
              <span
                className={cn(
                  'block h-[7px] w-[7px] rotate-45 border transition-colors',
                  hasUnlockedCurrentKeyframes
                    ? 'border-neutral-200 bg-neutral-200'
                    : 'border-current bg-transparent',
                )}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'text-muted-foreground hover:text-foreground',
                'opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
              )}
              onClick={(event) => {
                event.stopPropagation()
                handleRowNavigate(
                  group.nextKeyframe?.property ?? group.rows[0]?.property ?? 'x',
                  group.nextKeyframe?.keyframe ?? null,
                )
              }}
              disabled={disabled || group.nextKeyframe === null || !onNavigateToKeyframe}
              title={t('timeline.keyframeEditor.nextGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Next ${groupLabel} keyframe`,
              })}
              aria-label={t('timeline.keyframeEditor.nextGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Next ${groupLabel} keyframe`,
              })}
            >
              <ChevronRight className={MINI_ICON_CLASS} />
            </Button>
            <div className="mx-[1px] h-3 w-px bg-border/80" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'text-muted-foreground hover:text-foreground',
                'opacity-0 transition-opacity duration-100 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
              )}
              onClick={(event) => {
                event.stopPropagation()
                handleClearGroup(group)
              }}
              disabled={!canClearAny}
              title={t('timeline.keyframeEditor.clearAllGroupKeyframes', {
                group: groupLabel,
                defaultValue: `Clear all ${groupLabel} keyframes`,
              })}
              aria-label={t('timeline.keyframeEditor.clearAllGroupKeyframes', {
                group: groupLabel,
                defaultValue: `Clear all ${groupLabel} keyframes`,
              })}
            >
              <X className={MINI_ICON_CLASS} />
            </Button>
          </div>
        </div>
      )
    },
    [
      autoKeyEnabledByProperty,
      canAddKeyframeForRow,
      canClearRow,
      disabled,
      expandedGroups,
      handleClearGroup,
      handleGroupAutoKeyToggle,
      handleGroupToggleKeyframes,
      handleRowNavigate,
      graphVisibleProperties,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onRemoveKeyframes,
      onNavigateToKeyframe,
      onPropertyValueCommit,
      setGroupLocked,
      t,
      toggleGroupCurves,
      toggleGroup,
    ],
  )
  const rowElements = useMemo(
    () =>
      renderedSheetEntries.entries.map((entry) => {
        if (entry.type === 'group') {
          return (
            <div
              key={entry.group.id}
              className="grid w-full border-b border-border/60"
              style={{ ...propertyGridStyle, height: GROUP_HEADER_HEIGHT }}
            >
              {renderGroupHeaderContent(entry.group)}
              <GroupTimelineCell
                groupId={entry.group.id}
                groupLabel={entry.group.label}
                frameGroups={
                  groupTimelineById.get(entry.group.id)?.frameGroups ?? EMPTY_FRAME_GROUPS
                }
                rows={groupTimelineById.get(entry.group.id)?.rows ?? EMPTY_STRUCTURE_ROWS}
                ticks={ticks}
                frameToX={frameToX}
                getRenderedKeyframeX={getRenderedKeyframeX}
                selectedKeyframeIds={selectedKeyframeIds}
                disabled={disabled}
                isPropertyLocked={isPropertyLocked}
                onGroupKeyframePointerDown={handleGroupKeyframePointerDown}
                onBackgroundPointerDown={handleTimelineBackgroundPointerDown}
                sheetPreviewFrames={sheetPreviewFrames}
                sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
              />
            </div>
          )
        }

        const { row } = entry
        const rowLocked = isPropertyLocked(row.property)
        return (
          <div
            key={row.property}
            className="grid border-b border-border/60"
            style={{ ...propertyGridStyle, height: ROW_HEIGHT }}
          >
            {renderPropertyRowContent(row, { indented: true })}
            <PropertyTimelineCell
              property={row.property}
              keyframes={rowKeyframesByProperty.get(row.property) ?? EMPTY_KEYFRAMES}
              locked={rowLocked}
              ticks={ticks}
              frameToX={frameToX}
              getRenderedKeyframeX={getRenderedKeyframeX}
              renderedKeyframeXById={renderedKeyframeXById}
              transitionBlockedRanges={transitionBlockedRanges}
              selectedKeyframeIds={selectedKeyframeIds}
              disabled={disabled}
              onRowPointerDown={handleRowPointerDown}
              onKeyframePointerDown={handleKeyframePointerDown}
              setKeyframeButtonRef={setKeyframeButtonRef}
              keyframeMetaByIdRef={keyframeMetaByIdRef}
              sheetPreviewFrames={sheetPreviewFrames}
              sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
            />
          </div>
        )
      }),
    [
      renderedSheetEntries.entries,
      propertyGridStyle,
      groupTimelineById,
      rowKeyframesByProperty,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleGroupKeyframePointerDown,
      renderGroupHeaderContent,
      renderPropertyRowContent,
      getRenderedKeyframeX,
      isPropertyLocked,
      disabled,
      ticks,
      frameToX,
      transitionBlockedRanges,
      renderedKeyframeXById,
      selectedKeyframeIds,
      sheetPreviewDuplicateKeyframeIds,
      sheetPreviewFrames,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
      keyframeMetaByIdRef,
    ],
  )
  const propertyColumnElements = useMemo(
    () =>
      groupedPropertyRows.flatMap((group) => {
        const groupOpen = expandedGroups[group.id] ?? true
        const elements: React.ReactNode[] = [
          <div key={group.id} className="h-6 border-b border-border/60">
            {renderGroupHeaderContent(group)}
          </div>,
        ]

        if (!groupOpen) {
          return elements
        }

        return elements.concat(
          group.rows.map((row) => (
            <div
              key={row.property}
              className="border-b border-border/60"
              style={{ height: ROW_HEIGHT }}
            >
              {renderPropertyRowContent(row, { indented: true })}
            </div>
          )),
        )
      }),
    [expandedGroups, groupedPropertyRows, renderGroupHeaderContent, renderPropertyRowContent],
  )
  const emptyStateMessage = hasPropertyFilters
    ? t('timeline.keyframeEditor.noParametersMatch')
    : t('timeline.keyframeEditor.noKeyframesToDisplay')
  const showEmptyGuidance = !hasPropertyFilters

  // Hoisted so the graph pane and sheet body can be composed once and reused
  // across the exclusive (`graph`/`dopesheet`) and the `split` placements.
  const rulerHeaderElement = (
    <DopesheetRulerHeader
      propertyGridStyle={propertyGridStyle}
      timelineRef={timelineRef}
      onRulerPointerDown={handleRulerPointerDown}
      onRulerPointerMove={handleRulerPointerMove}
      onRulerPointerUp={handleRulerPointerUp}
      rulerTickElements={rulerTickElements}
      playheadFlag={
        <DopesheetPlayheadLine
          variant="flag"
          relativeFrame={currentFrame}
          itemFrom={itemFrom}
          totalFrames={totalFrames}
          frameToX={frameToX}
          maxLeft={effectiveTimelineWidth - 1}
          className="absolute top-0 bottom-0 pointer-events-none z-10"
        />
      }
    />
  )
  // The timeline cells (ruler, rows, graph) all sit behind a 1px `border-l`, so
  // their content origin is `columnWidth + 1`. The playhead overlay isn't inside
  // those cells, so it must add that 1px to line up with ticks, keyframes and the
  // ruler flag.
  const timelineContentLeft = columnWidth + 1
  const playheadOverlayElement = (
    <div
      data-testid="dopesheet-playhead-clip"
      className="absolute top-0 bottom-0 right-0 overflow-hidden pointer-events-none z-20"
      style={{ left: timelineContentLeft }}
    >
      <DopesheetPlayheadLine
        relativeFrame={currentFrame}
        itemFrom={itemFrom}
        totalFrames={totalFrames}
        frameToX={frameToX}
        maxLeft={effectiveTimelineWidth - 1}
        className="absolute top-0 bottom-0"
      />
    </div>
  )
  // Split view: one shared playhead line spanning the sheet + graph panes (the
  // graph's own line is hidden via `hidePlayhead`). A single element guarantees
  // the two panes can't drift in position or appearance.
  const splitPlayheadOverlayElement = (
    <div
      data-testid="dopesheet-playhead-clip"
      className="absolute right-0 bottom-0 overflow-hidden pointer-events-none z-30"
      style={{ left: timelineContentLeft, top: RULER_HEIGHT }}
    >
      <DopesheetPlayheadLine
        relativeFrame={currentFrame}
        itemFrom={itemFrom}
        totalFrames={totalFrames}
        frameToX={frameToX}
        maxLeft={effectiveTimelineWidth - 1}
        className="absolute top-0 bottom-0"
      />
    </div>
  )
  const sheetBodyElement = (
    <DopesheetSheetBody
      scrollAreaRef={scrollAreaRef}
      hasRows={sheetRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      rowElements={rowElements}
      marqueeRect={marqueeRect}
      marqueeJustEnded={marqueeJustEndedRef.current}
      propertyColumnWidth={columnWidth}
      onTimelineBackgroundPointerDown={handleTimelineBackgroundPointerDown}
    />
  )
  const graphPaneElement = (
    <DopesheetGraphPane
      hasRows={propertyRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      propertyColumnElements={propertyColumnElements}
      propertyColumnWidth={columnWidth}
      graphPaneRef={graphPaneRef}
      disabled={disabled}
      graphDisplayPropertyLocked={graphDisplayPropertyLocked}
      focusGraphPane={focusGraphPane}
      handleGraphPaneKeyDown={handleGraphPaneKeyDown}
      graphPaneSize={graphPaneSize}
      graphVisiblePropertiesSize={graphVisibleProperties.size}
      viewport={viewport}
      updateViewport={updateViewport}
      itemId={itemId}
      keyframesByProperty={keyframesByProperty}
      graphDisplayProperty={graphDisplayProperty}
      graphVisibleProperties={[...graphVisibleProperties]}
      selectedKeyframeIds={selectedKeyframeIds}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      fps={fps}
      onKeyframeMove={onKeyframeMove}
      timingStripPreviewFrames={timingStripPreviewFrames}
      constrainGraphFrameDelta={constrainGraphFrameDelta}
      onBezierHandleMove={onBezierHandleMove}
      onSelectionChange={onSelectionChange}
      onPropertyChange={onPropertyChange}
      onScrub={onScrub}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onAddKeyframe={onAddKeyframe}
      onRemoveKeyframes={onRemoveKeyframes}
      onNavigateToKeyframe={onNavigateToKeyframe}
      transitionBlockedRanges={transitionBlockedRanges}
      snapEnabled={snapEnabled}
      graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
      graphRulerUnit={graphRulerUnit}
      autoZoomGraphHeight={autoZoomGraphHeight}
      graphVerticalZoomValue={graphVerticalZoomValue}
      hidePlayhead={isSplitView}
    />
  )

  return (
    <div
      className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
      style={{ height, width }}
    >
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {t('timeline.keyframeEditor.parameters')}
            </span>
            <DopesheetParameterMenu
              disabled={disabled}
              hasAvailableProperties={availableProperties.length > 0}
              parameterFilter={showKeyframedOnly ? 'keyframed' : 'all'}
              onToggleKeyframedOnly={() => setShowKeyframedOnly((prev) => !prev)}
              allPropertyGroups={allPropertyGroups}
              visibleGroups={visibleGroups}
              onToggleVisibleGroup={toggleVisibleGroup}
              onExpandAll={() => setAllGroupsExpanded(true)}
              onCollapseAll={() => setAllGroupsExpanded(false)}
              onResetParameterView={resetParameterView}
            />
          </div>

          {hasPropertyFilters && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t('timeline.keyframeEditor.filtered')}
            </span>
          )}

          {showGraphPane && graphDisplayProperty && (
            <span className="text-xs text-muted-foreground">
              {t('timeline.keyframeEditor.graphLabel', {
                property: getKeyframePropertyLabel(t, graphDisplayProperty),
              })}
            </span>
          )}

          <span className="text-xs text-muted-foreground">
            {t('timeline.keyframeEditor.keyframes', { count: visibleKeyframes.length })}
          </span>

          <DopesheetHeaderFrameInputs
            disabled={disabled}
            inputsEnabled={
              Boolean(onKeyframeMove) &&
              selectedFrameSummary.hasSelection &&
              !selectedFrameSummary.hasMixedFrames
            }
            totalFrames={totalFrames}
            globalFrame={globalFrame}
            localFrameInputValue={localFrameInputValue}
            globalFrameInputValue={globalFrameInputValue}
            setLocalFrameInputValue={setLocalFrameInputValue}
            setGlobalFrameInputValue={setGlobalFrameInputValue}
            skipNextHeaderFrameBlurRef={skipNextHeaderFrameBlurRef}
            commitLocalFrameInput={commitLocalFrameInput}
            commitGlobalFrameInput={commitGlobalFrameInput}
            handleHeaderFrameInputKeyDown={handleHeaderFrameInputKeyDown}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {showGraphPane && (
            <DopesheetInterpolationButtons
              options={interpolationOptions}
              selected={selectedInterpolation}
              disabled={disabled || interpolationDisabled}
              onSelect={onInterpolationChange}
            />
          )}
          <DopesheetClipboardActions
            disabled={disabled}
            hasSelection={selectedRefs.length > 0}
            hasKeyframeClipboard={hasKeyframeClipboard}
            isKeyframeClipboardCut={isKeyframeClipboardCut}
            onCopyKeyframes={onCopyKeyframes}
            onCutKeyframes={onCutKeyframes}
            onPasteKeyframes={onPasteKeyframes}
          />
          <DopesheetEditActions
            disabled={disabled}
            hasSelection={selectedRefs.length > 0}
            removeKeyframesAvailable={Boolean(onRemoveKeyframes)}
            handleRemoveKeyframes={handleRemoveKeyframes}
            horizontalZoomValue={horizontalZoomValue}
            horizontalZoomDisabled={horizontalZoomRatioBase <= 1}
            setHorizontalZoomValue={setHorizontalZoomValue}
            resetViewport={resetViewport}
            visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
            graphVerticalZoomValue={graphVerticalZoomValue}
            verticalZoomDisabled={visibleGraphProperties.length === 0 || verticalZoomRatioBase <= 1}
            setGraphVerticalZoomValue={setGraphVerticalZoomValue}
          />
          <DopesheetLegendPopover disabled={disabled} />
          <DopesheetViewOptionsMenu
            disabled={disabled}
            visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
            graphRulerUnit={graphRulerUnit}
            onChangeRulerUnit={setGraphRulerUnit}
            graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
            onToggleGraphHandleVisibility={() => setShowAllGraphHandles((prev) => !prev)}
            autoZoomGraphHeight={autoZoomGraphHeight}
            onToggleAutoZoomGraphHeight={() => setAutoZoomGraphHeight((prev) => !prev)}
          />
        </div>
      </div>

      <div
        className={cn(
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden relative',
          disabled && 'opacity-60 pointer-events-none',
          isSplitView && 'flex flex-col',
        )}
        onWheel={visualizationMode === 'dopesheet' ? handleWheel : undefined}
      >
        {isSplitView ? (
          <>
            {rulerHeaderElement}
            {/* Sheet on top, curve/graph below, with ONE shared playhead line
                ({splitPlayheadOverlayElement}) drawn over both panes so they
                stay identical in position and appearance. */}
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              onWheel={handleSplitSheetWheel}
            >
              {sheetBodyElement}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden border-t border-border/60">
              {graphPaneElement}
            </div>
            {splitPlayheadOverlayElement}
          </>
        ) : (
          <>
            {/* Sheet mode only: the graph renders its own aligned playhead
                (GraphPlayhead) using the graph's coordinate space. */}
            {showSheetPane && playheadOverlayElement}
            {rulerHeaderElement}
            {showGraphPane ? graphPaneElement : sheetBodyElement}
          </>
        )}
      </div>
      {showGraphPane && (
        <div className="grid" style={propertyGridStyle}>
          <div className="h-4 border-t border-r border-border/60 bg-background/80" />
          <div data-testid="keyframe-timing-strip-viewport-column">
            <KeyframeTimingStrip
              viewport={viewport}
              contentFrameMax={contentFrameMax}
              markers={timingStripMarkers}
              previewFrames={timingStripPreviewFrames}
              disabled={disabled || timingStripMarkers.length === 0}
              onSelectionChange={handleTimingStripSelectionChange}
              onSlideStart={handleTimingStripSlideStart}
              onSlideChange={handleTimingStripSlideChange}
              onSlideEnd={handleTimingStripSlideEnd}
            />
          </div>
        </div>
      )}
      <div className="grid" style={propertyGridStyle}>
        <div
          data-testid="keyframe-navigator-property-column"
          className="h-5 border-t border-r border-border/60 bg-background/80"
        />
        <div data-testid="keyframe-navigator-viewport-column">
          <CompactNavigator
            viewport={viewport}
            currentFrame={currentFrame}
            contentFrameMax={contentFrameMax}
            minVisibleFrames={minViewportFrames}
            disabled={disabled}
            onViewportChange={updateViewport}
          />
        </div>
      </div>
    </div>
  )
})
