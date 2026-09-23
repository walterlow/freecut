/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout'
import { CompactNavigator } from './compact-navigator'

import { DopesheetGraphPane } from './dopesheet-graph-pane'
import { useGraphViewState } from './use-graph-view-state'
import { useGroupExpansion } from './use-group-expansion'
import { useHeaderFrameInputs } from './use-header-frame-inputs'
import { usePropertyFilters } from './use-property-filters'
import { useRulerScrub } from './use-ruler-scrub'
import { useDopesheetMarquee } from './use-dopesheet-marquee'
import { useTimingStripDrag } from './use-timing-strip-drag'
import { useDopesheetViewport } from './use-dopesheet-viewport'
import { useDopesheetNavigation } from './use-dopesheet-navigation'
import { useDopesheetSheetRows } from './use-dopesheet-sheet-rows'
import {
  useDopesheetPointerDispatch,
  useLinkedTimelineWheelForwarding,
} from './use-dopesheet-pointer-dispatch'
import { useSelectionFrameActions } from './use-selection-frame-actions'
import { usePropertyValueEditing } from './use-property-value-editing'
import { useElementSize } from './use-element-size'
import { useKeyframeDrag } from './use-keyframe-drag'
import { useSheetPreviewDom } from './sheet-preview-dom'
import {
  getDopesheetDragPixelsPerFrame,
} from './dopesheet-drag-math'
import {
  DopesheetClassicPresentation,
  DopesheetEditorPresentation,
  DopesheetLanesPresentation,
} from './dopesheet-presentation'
import { DopesheetRulerHeader } from './dopesheet-ruler-header'
import { DopesheetLiveRulerCanvas } from './dopesheet-live-ruler-canvas'
import { syncDopesheetLivePixelGeometry } from './dopesheet-live-pixel-geometry'

import { perfMarkRender } from '@/shared/logging/perf-marks'
import {
  TIMELINE_LIVE_SCROLL_EVENT,
} from '@/shared/timeline/live-scroll-sync'
import {
} from '@/shared/timeline/main-timeline-scrub'
import { DopesheetSheetBody } from './dopesheet-sheet-body'

import { DopesheetToolbar } from './dopesheet-toolbar'
import { DopesheetPlayheadOverlay } from './dopesheet-playhead-overlays'
import {
  handleAddKeyframeHotkey,
  handleDeleteHotkey,
  handleFitKeyframesHotkey,
  handleNavigateHotkey,
  handleNudgeHotkey,
  handleToggleAutoKeyHotkey,
  resolveDopesheetHotkeys,
} from './dopesheet-hotkeys'
import { usePropertyExpressionEditor } from './use-property-expression-editor'
import { buildExpressionDockContext, formatExpressionValue } from './expression-dock-context'

import { DopesheetExpressionDock } from './dopesheet-expression-dock'
import type {
  DopesheetGroupHeaderProps,
  DopesheetPropertyRowContentProps,
} from './dopesheet-row-renderers'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import { KeyframeTimingStrip } from './keyframe-timing-strip'
import {
  buildGroupedPropertyRows,
  buildGroupedPropertyStructure,
  getNiceTickStep,
} from './dopesheet-helpers'

import {
} from '@/features/keyframes/deps/timeline-playhead'
import {
  EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
  GROUP_HEADER_HEIGHT,
  PROPERTY_COLUMN_WIDTH,
  SPACIOUS_PROPERTY_COLUMN_WIDTH,
  ROW_HEIGHT,
  SNAP_THRESHOLD_PX,
} from './dopesheet-constants'
import type {
  DopesheetPropertyGroup,
  DopesheetPropertyRow,
  DragState,
  KeyframeMeta,
  RenderedSheetEntry,
} from './dopesheet-types'
import { getDopesheetRowControlState } from './row-controls'
import { getPropertyAccordionGroups } from './property-groups'
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils'
import {
  PROPERTY_VALUE_RANGES,
  isColorAnimatableProperty,
} from '@/features/keyframes/property-value-ranges'
import { keyframeValueToHexColor } from '@/features/keyframes/utils/color-keyframes'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store'
import { getProceduralBands } from '@/features/keyframes/utils/procedural-preview'
import { clampFrame } from './frame-utils'
import {
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  removeSelectionIds,
} from './row-action-helpers'
import { getKeyframePropertyLabel } from '@/features/keyframes/utils/property-i18n'
import type { DopesheetEditorProps } from './dopesheet-editor-props'


// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_PROPERTY_GROUP_IDS: readonly string[] = []
const EMPTY_HIDDEN_PROPERTIES: readonly AnimatableProperty[] = []
const EMPTY_COMPOUND_ROWS: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>> = {}
const EMPTY_COMPOUND_SECONDARIES: Partial<Record<AnimatableProperty, AnimatableProperty>> = {}
const EMPTY_DIMENSION_SEPARATION: NonNullable<
  DopesheetEditorProps['dimensionSeparationByProperty']
> = {}

/**
 * Properties shown in the graph pane: in single-curve mode only the selected
 * property (plus its compound secondary), otherwise all visible properties.
 */
function resolveGraphVisiblePropertyList(
  singleCurveMode: boolean | undefined,
  graphDisplayProperty: AnimatableProperty | null,
  compoundSecondaryProperties: Partial<Record<AnimatableProperty, AnimatableProperty>>,
  visibleGraphProperties: AnimatableProperty[],
): AnimatableProperty[] {
  return singleCurveMode && graphDisplayProperty
    ? [
        graphDisplayProperty,
        ...(compoundSecondaryProperties[graphDisplayProperty]
          ? [compoundSecondaryProperties[graphDisplayProperty]!]
          : []),
      ]
    : visibleGraphProperties
}



export const DopesheetEditor = memo(function DopesheetEditor({
  frameViewport,
  onFrameViewportChange,
  clampViewportToContent = true,
  viewportInteractionEnabled = true,
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  playheadFrame,
  playheadClampToItemBounds = true,
  globalFrame = null,
  itemFrom = 0,
  totalFrames = 300,
  affectedFrameRange,
  trimmedKeyframeCount = 0,
  onTrimAnimation,
  fps = 30,
  width = 600,
  height = 260,
  onKeyframeMove,
  onKeyframesMove,
  onBezierHandleMove,
  onSegmentEasingChange,
  onSelectionChange,
  additionalSnapFrames = [],
  onSelectionFrameDelta,
  onPropertyChange,
  onCurveVisibilityChange,
  onActivePropertyChange,
  onScrub,
  onSkim,
  globalFrameToPixels,
  timelineScrollContainerRef,
  timelinePanBaseScrollLeft,
  timelinePanBasePixelsPerSecond,
  linkedTimelineViewportWidth,
  getTimelineLivePixelsPerSecond,
  onRulerEdgeScroll,
  scrubClampToItemBounds = true,
  scrubFrameBounds,
  onScrubStart,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onAddKeyframe,
  onDuplicateKeyframes,
  propertyValues = {},
  hiddenPropertyRows = EMPTY_HIDDEN_PROPERTIES,
  compoundPropertyRows = EMPTY_COMPOUND_ROWS,
  compoundSecondaryProperties = EMPTY_COMPOUND_SECONDARIES,
  dimensionSeparationByProperty = EMPTY_DIMENSION_SEPARATION,
  onPropertyValueCommit,
  onPropertyValuePreview,
  propertyLinks,
  propertyLinkSourceLabels,
  onPropertyLinkPointerDown,
  onRemovePropertyLink,
  linkedTransformExpressions = [],
  linkedTransformSourceLabels = {},
  onLinkedTransformPointerDown,
  onRemoveLinkedTransform,
  propertyExpressions = [],
  preExpressionPropertyValues = {},
  resolveExpressionReference,
  onSetPropertyExpression,
  onRemovePropertyExpression,
  onExpressionDockHeightChange,
  onLaneContentHeightChange,
  initialExpandedGroups,
  onExpandedGroupsChange,
  onResetPropertiesToDefault,
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
  proceduralPreview,
  motionModifiers,
  textMotionBands = [],
  onTextMotionDurationDragStart,
  onTextMotionDurationCommit,
  onTextMotionDurationCancel,
  onTextMotionOffsetDragStart,
  onTextMotionOffsetCommit,
  onTextMotionOffsetCancel,
  onTextMotionBandClick,
  hasProceduralMotion = false,
  canBakeMotion = false,
  onBakeMotion,
  disabled = false,
  visualizationMode = 'dopesheet',
  graphMode = 'value',
  onGraphModeChange,
  speedGraphContent,
  spacious = false,
  inlinePropertyGroupIds = EMPTY_PROPERTY_GROUP_IDS,
  propertyLabels = {},
  axisConstraintByProperty = {},
  presentation = 'editor',
  propertyColumnWidth,
  timelineGridDivisions,
  singleCurveMode = false,
  selectedCurveVisibleExternally = false,
  propertyFilter,
  proceduralFrameOffset = 0,
  proceduralDurationInFrames = totalFrames,
  initialVisibleGroupIds,
  showPlayhead = true,
  shortcutsEnabled = false,
  addKeyframeShortcutEnabled = false,
  shortcuts,
  className,
}: DopesheetEditorProps) {
  perfMarkRender('DopesheetEditor')
  const { t } = useTranslation()
  const resolvedPropertyLinks = propertyLinks ?? linkedTransformExpressions
  const resolvedPropertyLinkSourceLabels = propertyLinkSourceLabels ?? linkedTransformSourceLabels
  const beginPropertyLink = onPropertyLinkPointerDown ?? onLinkedTransformPointerDown
  const removePropertyLink = onRemovePropertyLink ?? onRemoveLinkedTransform
  // `split` shows both panes at once. Derive per-pane visibility so the many
  // mode branches below read intent ("is the graph showing?") rather than an
  // exact mode, and the exclusive `dopesheet`/`graph` modes stay unchanged.
  const showSheetPane = visualizationMode !== 'graph'
  const showGraphPane = visualizationMode !== 'dopesheet'
  const isSplitView = visualizationMode === 'split'
  // Wider property column + value inputs when there is room (Animate workspace).
  const columnWidth =
    propertyColumnWidth ?? (spacious ? SPACIOUS_PROPERTY_COLUMN_WIDTH : PROPERTY_COLUMN_WIDTH)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const graphPaneRef = useRef<HTMLDivElement>(null)
  const committedKeyframeSelectionRef = useRef(selectedKeyframeIds)
  committedKeyframeSelectionRef.current = selectedKeyframeIds
  const snapEnabled = true
  const pickWhipRootRef = useRef<HTMLDivElement>(null)
  const syncLivePixelGeometryRef = useRef<() => void>(() => {})
  const {
    expressionEditor,
    setExpressionEditor,
    expressionReferencePick,
    setExpressionReferencePick,
    expressionReferenceDrag,
    beginExpressionReferenceDrag,
    expressionDockRef,
    expressionTextareaRef,
    openPropertyExpressionEditor,
    applyExpressionPreset,
  } = usePropertyExpressionEditor({ onExpressionDockHeightChange, pickWhipRootRef })
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId],
    ),
  )
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled)
  const [sheetPreviewFrames, setSheetPreviewFrames] = useState<Record<string, number> | null>(null)
  const [sheetPreviewDuplicateKeyframeIds, setSheetPreviewDuplicateKeyframeIds] = useState<
    string[] | null
  >(null)

  const keyframeFrameBounds = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const list of Object.values(keyframesByProperty)) {
      for (const keyframe of list ?? []) {
        if (keyframe.frame < min) min = keyframe.frame
        if (keyframe.frame > max) max = keyframe.frame
      }
    }
    return max >= min ? { min, max } : null
  }, [keyframesByProperty])

  const { viewport, updateViewport, normalizeViewport, contentFrameMax, minViewportFrames } =
    useDopesheetViewport({
      itemId,
      totalFrames,
      keyframeFrameBounds,
      frameViewport,
      onFrameViewportChange,
      clampToContent: clampViewportToContent,
    })

  const { width: timelineWidth } = useElementSize(timelineRef, {
    deps: [visualizationMode],
  })
  const { width: sheetScrollWidth } = useElementSize(scrollAreaRef, {
    enabled: showSheetPane,
    deps: [visualizationMode],
  })

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty],
  )
  const hiddenPropertyRowSet = useMemo(
    () => new Set<AnimatableProperty>(hiddenPropertyRows),
    [hiddenPropertyRows],
  )
  // Properties with an actual curve to draw (>= 2 keyframes). The graph picks a
  // default from these so it isn't blank when the selected/first property only
  // has a single keyframe.
  const graphableProperties = useMemo(
    () =>
      availableProperties.filter(
        (property) =>
          !isColorAnimatableProperty(property) && (keyframesByProperty[property]?.length ?? 0) >= 2,
      ),
    [availableProperties, keyframesByProperty],
  )
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties],
  )
  const inlinePropertyGroupIdSet = useMemo(
    () => new Set(inlinePropertyGroupIds),
    [inlinePropertyGroupIds],
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
  const proceduralBandByProperty = useMemo(
    () => getProceduralBands(motionModifiers, proceduralDurationInFrames, proceduralFrameOffset),
    [motionModifiers, proceduralDurationInFrames, proceduralFrameOffset],
  )
  const {
    graphVisibleProperties,
    setGraphVisibleProperties,
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
    graphableProperties,
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
  } = usePropertyFilters({
    allPropertyGroups,
    availableProperties,
    initialVisibleGroupIds,
  })
  const filterKeyframedOnly =
    propertyFilter === undefined ? showKeyframedOnly : propertyFilter === 'keyframed'
  const linkedTransformPropertyIds = useMemo(
    () =>
      new Set<string>(
        resolvedPropertyLinks.map((link) => {
          if (link.targetProperty === 'position') return 'x'
          if (link.targetProperty === 'scale') return 'width'
          if (link.targetProperty === 'anchor') return 'anchorX'
          return link.targetProperty
        }),
      ),
    [resolvedPropertyLinks],
  )

  const filteredProperties = useMemo(
    () =>
      availableProperties
        .filter((property) => !hiddenPropertyRowSet.has(property))
        .filter((property) => {
          const groupId = propertyGroupIdByProperty.get(property)
          const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true
          if (!groupVisible) return false
          if (
            filterKeyframedOnly &&
            !keyframedPropertyIds.has(property) &&
            !linkedTransformPropertyIds.has(property) &&
            !proceduralBandByProperty.has(property)
          )
            return false
          return true
        }),
    [
      availableProperties,
      hiddenPropertyRowSet,
      keyframedPropertyIds,
      linkedTransformPropertyIds,
      proceduralBandByProperty,
      propertyGroupIdByProperty,
      filterKeyframedOnly,
      visibleGroups,
    ],
  )
  const activeSelectedProperty =
    selectedProperty && filteredProperties.includes(selectedProperty) ? selectedProperty : null
  const visibleProperties = filteredProperties
  const propertyColumnProperties = filteredProperties
  const hasPropertyFilters =
    filterKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false)

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
    initialExpandedGroups,
    onExpandedGroupsChange,
  })

  // Shift-clicking any row's lock icon applies that row's next lock state to
  // every visible row, so "lock everything except this one" is two clicks.
  const setAllRowsLocked = useCallback(
    (locked: boolean) => {
      setGroupLocked(visibleProperties, locked)
    },
    [setGroupLocked, visibleProperties],
  )

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
      if (isColorAnimatableProperty(property)) return keyframeValueToHexColor(value)
      const decimals = PROPERTY_VALUE_RANGES[property]?.decimals ?? 2
      return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals)
    },
    [],
  )

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
  const visibleGraphProperties = useMemo(() => {
    const properties = new Set(graphVisibleProperties)
    for (const property of graphVisibleProperties) {
      const secondary = compoundSecondaryProperties[property]
      if (secondary) properties.add(secondary)
    }
    return [...properties]
  }, [compoundSecondaryProperties, graphVisibleProperties])
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
  const fullTimelineWidth = timelineWidth || fallbackTimelineWidth
  const sheetTimelineWidth = Math.max(0, sheetScrollWidth - columnWidth)
  const alignedTimelineWidth =
    showSheetPane && sheetTimelineWidth > 0
      ? Math.min(fullTimelineWidth, sheetTimelineWidth)
      : fullTimelineWidth
  const reservedScrollbarGutterWidth = Math.max(0, fullTimelineWidth - alignedTimelineWidth)
  // The Edit lane shares the main timeline's axis. Its own grid is a couple of
  // pixels narrower because of a border and scrollbar gutter, so using its
  // measured width introduces a small but persistent time-to-pixel drift. Let
  // the main viewport be authoritative whenever it is linked.
  const hasLinkedTimelineAxis =
    presentation === 'classic' &&
    linkedTimelineViewportWidth !== undefined &&
    linkedTimelineViewportWidth > 0
  const timelineCellBorderWidth =
    presentation === 'classic'
      ? hasLinkedTimelineAxis
        ? 0
        : 1
      : presentation === 'lanes'
        ? 1
        : 0
  const effectiveTimelineWidth = Math.max(
    hasLinkedTimelineAxis
      ? linkedTimelineViewportWidth
      : alignedTimelineWidth - timelineCellBorderWidth,
    1,
  )
  const timelineEdgeInset = presentation === 'classic' ? 0 : undefined
  const timelinePixelsPerSecond = useMemo(
    () => (effectiveTimelineWidth / frameRange) * fps,
    [effectiveTimelineWidth, frameRange, fps],
  )
  const getLiveDragPixelsPerFrame = useCallback(
    () =>
      getDopesheetDragPixelsPerFrame(getTimelineLivePixelsPerSecond, timelinePixelsPerSecond, fps),
    [fps, getTimelineLivePixelsPerSecond, timelinePixelsPerSecond],
  )

  useLayoutEffect(() => {
    const scrollContainer = timelineScrollContainerRef?.current
    const root = pickWhipRootRef.current
    if (!scrollContainer || !root || timelinePanBaseScrollLeft === undefined) {
      syncLivePixelGeometryRef.current = () => {}
      return
    }

    let scrollFrame: number | null = null
    const syncLiveGeometry = () => {
      const pixelsPerSecond =
        getTimelineLivePixelsPerSecond?.() ??
        timelinePanBasePixelsPerSecond ??
        timelinePixelsPerSecond
      syncDopesheetLivePixelGeometry({
        root,
        pixelsPerSecond,
        fps,
        scrollLeft: scrollContainer.scrollLeft,
        itemFrom,
        // Linked Edit cells retain a one-pixel left border. Their absolutely
        // positioned contents begin just inside it, so compensate without
        // transforming or scaling the surface.
        originOffset: hasLinkedTimelineAxis ? -1 : 0,
      })
    }
    const scheduleScrollSync = () => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        syncLiveGeometry()
      })
    }
    const syncLiveEvent = () => {
      if (scrollFrame !== null) {
        cancelAnimationFrame(scrollFrame)
        scrollFrame = null
      }
      syncLiveGeometry()
    }

    syncLivePixelGeometryRef.current = syncLiveGeometry
    syncLiveGeometry()
    scrollContainer.addEventListener('scroll', scheduleScrollSync, { passive: true })
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollContainer.removeEventListener('scroll', scheduleScrollSync)
      scrollContainer.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
      syncLivePixelGeometryRef.current = () => {}
    }
  }, [
    fps,
    getTimelineLivePixelsPerSecond,
    hasLinkedTimelineAxis,
    itemFrom,
    timelinePanBasePixelsPerSecond,
    timelinePanBaseScrollLeft,
    timelinePixelsPerSecond,
    timelineScrollContainerRef,
  ])
  useLayoutEffect(() => {
    // React may add drag previews or filtered rows without changing the live
    // axis inputs. Bring those new nodes onto the same current pixel axis before
    // the browser paints them.
    syncLivePixelGeometryRef.current()
  })

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )
  const affectedFrameRangeGeometry = useMemo(() => {
    if (!affectedFrameRange || affectedFrameRange.toFrame <= affectedFrameRange.fromFrame) {
      return null
    }
    const rawLeft = frameToX(affectedFrameRange.fromFrame)
    const rawRight = frameToX(affectedFrameRange.toFrame)
    const left = Math.max(0, Math.min(effectiveTimelineWidth, rawLeft))
    const right = Math.max(0, Math.min(effectiveTimelineWidth, rawRight))
    if (right <= left) return null
    return { left, width: right - left }
  }, [affectedFrameRange, effectiveTimelineWidth, frameToX])
  const sharedGridFrameToX = useCallback(
    (frame: number) =>
      getFrameAxisX(
        frame,
        viewport,
        effectiveTimelineWidth + timelineCellBorderWidth,
        0,
      ) - timelineCellBorderWidth,
    [effectiveTimelineWidth, timelineCellBorderWidth, viewport],
  )
  const getRenderedKeyframeX = useCallback(
    (frame: number) =>
      getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
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
    const textMotionRowCount = presentation === 'classic' ? textMotionBands.length : 0
    let top = textMotionRowCount * ROW_HEIGHT

    for (const group of groupedSheetRows) {
      const inline = presentation === 'classic' || inlinePropertyGroupIdSet.has(group.id)
      if (!inline) {
        entries.push({ type: 'group', group, top })
        top += GROUP_HEADER_HEIGHT
      }

      if (!inline && !(expandedGroups[group.id] ?? true)) {
        continue
      }

      for (const row of group.rows) {
        entries.push({ type: 'row', row, top, indented: !inline })
        top += ROW_HEIGHT
      }
    }

    return {
      entries,
      contentHeight: top,
    }
  }, [
    expandedGroups,
    groupedSheetRows,
    inlinePropertyGroupIdSet,
    presentation,
    textMotionBands.length,
  ])
  useLayoutEffect(() => {
    if (presentation !== 'lanes') return
    onLaneContentHeightChange?.(renderedSheetEntries.contentHeight)
  }, [onLaneContentHeightChange, presentation, renderedSheetEntries.contentHeight])
  // Marquee points are only needed while a selection marquee is moving.
  // Building them eagerly duplicated the viewport-sensitive keyframe position
  // pass on every zoom frame, even when no marquee interaction was active.
  const getKeyframePoints = useCallback(
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

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return currentFrame
      const rect = node.getBoundingClientRect()
      const frame = xToFrame(clientX - rect.left - timelineCellBorderWidth)
      if (scrubClampToItemBounds) return clampFrame(frame, totalFrames)
      if (!scrubFrameBounds) return frame
      return Math.max(scrubFrameBounds.minFrame, Math.min(scrubFrameBounds.maxFrame, frame))
    },
    [
      currentFrame,
      scrubClampToItemBounds,
      scrubFrameBounds,
      timelineCellBorderWidth,
      totalFrames,
      xToFrame,
    ],
  )

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(
        0,
        Math.min(effectiveTimelineWidth - 1, clientX - rect.left - timelineCellBorderWidth),
      )
    },
    [effectiveTimelineWidth, timelineCellBorderWidth],
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
    if (timelineGridDivisions && timelineGridDivisions > 0) {
      return Array.from(
        { length: timelineGridDivisions + 1 },
        (_, index) =>
          viewport.startFrame + (index / timelineGridDivisions) * frameRange,
      )
    }
    const step = getNiceTickStep(frameRange)
    // Edit pans the already-rendered sheet on the compositor while expensive
    // keyframe rows settle less frequently. Keep a generous ruler-only buffer
    // on both sides so incoming tick marks are already present and move with
    // the main ruler instead of appearing at the next settled React update.
    const rulerOverscanFrames = timelineScrollContainerRef ? frameRange * 2 : 0
    const first = Math.floor((viewport.startFrame - rulerOverscanFrames) / step) * step
    const last = viewport.endFrame + rulerOverscanFrames
    const result: number[] = []
    for (let frame = first; frame <= last; frame += step) {
      result.push(frame)
    }
    return result
  }, [
    viewport.startFrame,
    viewport.endFrame,
    frameRange,
    timelineGridDivisions,
    timelineScrollContainerRef,
  ])

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

  // Adds inside a transition region are rejected by the action layer; surface
  // that instead of failing silently. A fixed toast id prevents stacking on
  // repeated clicks.
  const notifyKeyframeBlocked = useCallback(() => {
    toast.warning(t('timeline.keyframeEditor.transitionBlocked'), {
      id: 'keyframe-transition-blocked',
    })
  }, [t])

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame, ...additionalSnapFrames]
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame)
      }
    }
    return [...new Set(targets)]
  }, [additionalSnapFrames, visibleKeyframes, selectedKeyframeIds, currentFrame])

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

  const { setHorizontalZoomValue, resetViewport, fitKeyframesInView, handleWheel } =
    useDopesheetNavigation({
      updateViewport,
      normalizeViewport,
      contentFrameMax,
      minViewportFrames,
      horizontalZoomRatioBase,
      selectedKeyframeIds,
      keyframeMetaById,
      disabled,
      getFrameFromClientX,
      effectiveTimelineWidth,
      frameRange,
    })

  const {
    handleRemoveKeyframes,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    moveSelectedKeyframesByDelta,
  } = useSelectionFrameActions({
    selectedRefs,
    selectedRefIds,
    keyframeMetaByIdRef,
    isPropertyLocked,
    keyframesByProperty,
    totalFrames,
    transitionBlockedRanges,
    itemId,
    disabled,
    onRemoveKeyframes,
    onKeyframeMove,
    onKeyframesMove,
    onDuplicateKeyframes,
    onDragStart,
    onDragEnd,
  })


  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false
      if (isPropertyLocked(row.property)) return false
      return row.keyframes.length > 0
    },
    [disabled, isPropertyLocked, onRemoveKeyframes],
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
        if (singleCurveMode) {
          setGraphVisibleProperties(new Set([property]))
          onCurveVisibilityChange?.(property, true)
        }
        onPropertyChange?.(property)
      }
      onActivePropertyChange?.(property)
    },
    [
      onActivePropertyChange,
      onCurveVisibilityChange,
      onPropertyChange,
      setGraphVisibleProperties,
      showGraphPane,
      singleCurveMode,
    ],
  )

  const showSinglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties(new Set([property]))
      onPropertyChange?.(property)
      onActivePropertyChange?.(property)
      onCurveVisibilityChange?.(property, true)
    },
    [onActivePropertyChange, onCurveVisibilityChange, onPropertyChange, setGraphVisibleProperties],
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
          { preserveExternalSelection: true },
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

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)))
    },
    [canClearRow, removeKeyframesForRows],
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
            { preserveExternalSelection: true },
          )
        }
        return
      }

      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      if (!onAddKeyframe) return
      onAddKeyframe(property, currentFrame)
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      notifyKeyframeBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ],
  )

  const handleRowAddKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) return
      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      onAddKeyframe?.(property, currentFrame)
    },
    [
      activateProperty,
      currentFrame,
      isCurrentFrameBlocked,
      isPropertyLocked,
      notifyKeyframeBlocked,
      onAddKeyframe,
    ],
  )

  const {
    valueDrafts,
    setValueDrafts,
    setEditingValueProperty,
    valueDraftAtFocusRef,
    skipNextBlurCommitPropertyRef,
    handleRowValueChange,
    handleRowValueCommit,
    handleValueScrubStart,
    handleValueScrubMove,
    handleValueScrubEnd,
    handleValueScrubCancel,
  } = usePropertyValueEditing({
    propertyColumnProperties,
    propertyValues,
    formatPropertyValue,
    isPropertyLocked,
    activateProperty,
    onPropertyValueCommit,
    onPropertyValuePreview,
    onDragStart,
    onDragEnd,
    onDragCancel,
  })

  const handleRowAutoKeyToggle = useCallback(
    (property: AnimatableProperty) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      toggleAutoKeyframeEnabled(itemId, property)
    },
    [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled],
  )


  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames)
    },
    [moveSelectedKeyframesByDelta],
  )

  const activePropertyRow = selectedProperty
    ? propertyRowByProperty.get(selectedProperty)
    : undefined
  const hotkeyBindings = resolveDopesheetHotkeys({
    shortcutsEnabled,
    addKeyframeShortcutEnabled,
    disabled,
    shortcuts,
    hasActivePropertyRow: !!activePropertyRow,
    hasSelection: selectedRefs.length > 0,
    canCommitValues: !!onPropertyValueCommit,
  })

  useHotkeys(
    hotkeyBindings.keys.add,
    (event) => handleAddKeyframeHotkey(event, activePropertyRow, handleRowAddKeyframe),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.add,
    },
    [
      hotkeyBindings.keys.add,
      hotkeyBindings.enabled.add,
      activePropertyRow,
      handleRowAddKeyframe,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.prev,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.prevKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.prev,
    },
    [
      hotkeyBindings.keys.prev,
      hotkeyBindings.enabled.prev,
      activePropertyRow,
      handleRowNavigate,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.next,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.nextKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.next,
    },
    [
      hotkeyBindings.keys.next,
      hotkeyBindings.enabled.next,
      activePropertyRow,
      handleRowNavigate,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.toggleAutoKey,
    (event) => handleToggleAutoKeyHotkey(event, activePropertyRow, handleRowAutoKeyToggle),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.toggleAutoKey,
    },
    [
      hotkeyBindings.keys.toggleAutoKey,
      hotkeyBindings.enabled.toggleAutoKey,
      activePropertyRow,
      handleRowAutoKeyToggle,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.fit,
    (event) => handleFitKeyframesHotkey(event, fitKeyframesInView),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.fit,
    },
    [hotkeyBindings.keys.fit, hotkeyBindings.enabled.fit, fitKeyframesInView],
  )

  useHotkeys(
    'delete,backspace',
    (event) => handleDeleteHotkey(event, selectedRefs, onRemoveKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, selectedRefs, onRemoveKeyframes],
  )

  useHotkeys(
    'left',
    (event) => handleNudgeHotkey(event, -1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'right',
    (event) => handleNudgeHotkey(event, 1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+left',
    (event) => handleNudgeHotkey(event, -10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+right',
    (event) => handleNudgeHotkey(event, 10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  const dragStateRef = useRef<DragState | null>(null)
  const selectionAnchorByPropertyRef = useRef(new Map<AnimatableProperty, string>())

  const { setKeyframeButtonRef, handleMarqueeSelectionPreviewChange, scheduleDragPreviewFrames } =
    useSheetPreviewDom({
      committedKeyframeSelectionRef,
      keyframeMetaByIdRef,
      dragStateRef,
      getRenderedKeyframeX,
      setSheetPreviewFrames,
      setSheetPreviewDuplicateKeyframeIds,
    })

  const { marqueeOverlayRef, getMarqueeModeFromPointerEvent, beginMarqueeSelection } =
    useDopesheetMarquee({
      getKeyframePoints,
      scrollAreaRef,
      getTimelineXFromClientX,
      getContentYFromClientY,
      onSelectionChange,
      onSelectionPreviewChange: handleMarqueeSelectionPreviewChange,
    })

  const keyframeDrag = useKeyframeDrag({
    disabled,
    totalFrames,
    snapEnabled,
    snapFrame,
    isPropertyLocked,
    selectedKeyframeIds,
    rowKeyframesByProperty,
    keyframeMetaByIdRef,
    dragStateRef,
    selectionAnchorByPropertyRef,
    scheduleDragPreviewFrames,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    getLiveDragPixelsPerFrame,
    onSelectionChange,
    onActivePropertyChange,
    onDragStart,
    onDragEnd,
    onDragCancel,
    onSelectionFrameDelta,
    onKeyframeMove,
    onDuplicateKeyframes,
  })
  const handleKeyframePointerDown = keyframeDrag.handleKeyframePointerDown
  const handleGroupKeyframePointerDown = keyframeDrag.handleGroupKeyframePointerDown


  const { handleRowPointerDown, handleTimelineBackgroundPointerDown } =
    useDopesheetPointerDispatch({
      disabled,
      isPropertyLocked,
      selectedKeyframeIds,
      onActivePropertyChange,
      beginMarqueeSelection,
      getMarqueeModeFromPointerEvent,
    })


  const rulerScrub = useRulerScrub({
    disabled,
    viewport,
    effectiveTimelineWidth,
    timelinePixelsPerSecond,
    fps,
    itemFrom,
    totalFrames,
    timelineEdgeInset,
    timelineCellBorderWidth,
    scrubClampToItemBounds,
    scrubFrameBounds,
    frameToX,
    globalFrameToPixels,
    getTimelineXFromClientX,
    getFrameFromClientX,
    getLiveDragPixelsPerFrame,
    getTimelineLivePixelsPerSecond,
    timelineRef,
    timelineScrollContainerRef,
    onScrub,
    onScrubStart,
    onScrubEnd,
    onSkim,
    onRulerEdgeScroll,
  })
  const isRulerScrubbing = rulerScrub.isRulerScrubbing
  const rulerScrubActiveRef = rulerScrub.rulerScrubActiveRef
  const rulerScrubHandoffFrameRef = rulerScrub.rulerScrubHandoffFrameRef
  const handleRulerPointerDown = rulerScrub.handleRulerPointerDown
  const handleRulerPointerMove = rulerScrub.handleRulerPointerMove
  const handleRulerPointerLeave = rulerScrub.handleRulerPointerLeave
  const handleRulerPointerUp = rulerScrub.handleRulerPointerUp


  useLinkedTimelineWheelForwarding({
    rootRef: pickWhipRootRef,
    timelineScrollContainerRef,
    viewportInteractionEnabled,
  })

  const graphDisplayProperty = useMemo(() => {
    if (graphVisibleProperties.size === 0) return null
    const graphableSet = new Set(graphableProperties)
    // Honour the selection when it has a drawable curve.
    if (
      activeSelectedProperty &&
      graphVisibleProperties.has(activeSelectedProperty) &&
      graphableSet.has(activeSelectedProperty)
    ) {
      return activeSelectedProperty
    }
    // Otherwise show the first visible property that actually has a curve, so the
    // graph isn't blank when the selection is a single-keyframe property.
    const graphableVisible = [...graphVisibleProperties].find((property) =>
      graphableSet.has(property),
    )
    if (graphableVisible) return graphableVisible
    // Fall back to the selection even without a full curve.
    if (activeSelectedProperty && graphVisibleProperties.has(activeSelectedProperty)) {
      return activeSelectedProperty
    }
    return null
  }, [activeSelectedProperty, graphVisibleProperties, graphableProperties])
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false
  const focusGraphPane = useCallback(() => {
    // `preventScroll` is essential: focusing a tabIndex={-1} element inside a
    // scrollable container makes the browser scroll it into view. Without this,
    // pressing a keyframe (which focuses the pane via onPointerDownCapture)
    // shifts the entire dopesheet scroll.
    graphPaneRef.current?.focus({ preventScroll: true })
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
  const rulerLabelFrameOffset = timelineScrollContainerRef ? itemFrom : 0
  const liveRulerCanvas =
    hasLinkedTimelineAxis && timelineScrollContainerRef ? (
      <DopesheetLiveRulerCanvas
        scrollContainerRef={timelineScrollContainerRef}
        getLivePixelsPerSecond={getTimelineLivePixelsPerSecond}
        fallbackPixelsPerSecond={timelinePixelsPerSecond}
        fps={fps}
        rulerUnit={graphRulerUnit}
      />
    ) : null
  // Shared row props: the sheet rows and the property column render the same
  // row content, which is now a memoized component instead of a callback.
  const rowContentProps = useMemo<Omit<DopesheetPropertyRowContentProps, 'row' | 'options'>>(
    () => ({
      activateProperty,
      axisConstraintByProperty,
      autoKeyEnabledByProperty,
      beginPropertyLink,
      canClearRow,
      compoundPropertyRows,
      compoundSecondaryProperties,
      itemId,
      itemFrom,
      currentFrame,
      fps,
      disabled,
      expressionEditor,
      formatPropertyValue,
      globalFrame,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      handleValueScrubEnd,
      handleValueScrubCancel,
      handleValueScrubMove,
      handleValueScrubStart,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onCurveVisibilityChange,
      onDragCancel,
      onDragEnd,
      onDragStart,
      onPropertyValueCommit,
      onPropertyValuePreview,
      resolvedPropertyLinks,
      resolvedPropertyLinkSourceLabels,
      removePropertyLink,
      propertyExpressions,
      propertyLabels,
      preExpressionPropertyValues,
      resolveExpressionReference,
      onSetPropertyExpression,
      openPropertyExpressionEditor,
      onResetPropertiesToDefault,
      propertyValues,
      presentation,
      selectedProperty,
      selectedCurveVisibleExternally,
      setAllRowsLocked,
      setEditingValueProperty,
      setValueDrafts,
      showGraphPane,
      showSinglePropertyCurve,
      singleCurveMode,
      skipNextBlurCommitPropertyRef,
      spacious,
      t,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDraftAtFocusRef,
      valueDrafts,
    }),
    [
      activateProperty,
      axisConstraintByProperty,
      autoKeyEnabledByProperty,
      beginPropertyLink,
      canClearRow,
      compoundPropertyRows,
      compoundSecondaryProperties,
      itemId,
      itemFrom,
      currentFrame,
      fps,
      disabled,
      expressionEditor,
      formatPropertyValue,
      globalFrame,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      handleValueScrubEnd,
      handleValueScrubCancel,
      handleValueScrubMove,
      handleValueScrubStart,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onCurveVisibilityChange,
      onDragCancel,
      onDragEnd,
      onDragStart,
      onPropertyValueCommit,
      onPropertyValuePreview,
      resolvedPropertyLinks,
      resolvedPropertyLinkSourceLabels,
      removePropertyLink,
      propertyExpressions,
      propertyLabels,
      preExpressionPropertyValues,
      resolveExpressionReference,
      onSetPropertyExpression,
      openPropertyExpressionEditor,
      onResetPropertiesToDefault,
      propertyValues,
      presentation,
      selectedProperty,
      selectedCurveVisibleExternally,
      setAllRowsLocked,
      setEditingValueProperty,
      setValueDrafts,
      showGraphPane,
      showSinglePropertyCurve,
      singleCurveMode,
      skipNextBlurCommitPropertyRef,
      spacious,
      t,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDraftAtFocusRef,
      valueDrafts,
    ],
  )
  // Shared group-header props: both the sheet rows and the property column
  // render the same header, which is now a component instead of a callback.
  const groupHeaderProps = useMemo<Omit<DopesheetGroupHeaderProps, 'group'>>(
    () => ({
      t,
      expandedGroups,
      graphVisibleProperties,
      dimensionSeparationByProperty,
      canClearRow,
      disabled,
      isPropertyLocked,
      onNavigateToKeyframe,
      onResetPropertiesToDefault,
      presentation,
      setAllGroupsExpanded,
      setAllRowsLocked,
      setGroupLocked,
      toggleGroup,
      toggleGroupCurves,
      handleClearGroup,
      handleRowNavigate,
    }),
    [
      canClearRow,
      dimensionSeparationByProperty,
      disabled,
      expandedGroups,
      graphVisibleProperties,
      handleClearGroup,
      handleRowNavigate,
      isPropertyLocked,
      onNavigateToKeyframe,
      onResetPropertiesToDefault,
      presentation,
      setAllGroupsExpanded,
      setAllRowsLocked,
      setGroupLocked,
      t,
      toggleGroup,
      toggleGroupCurves,
    ],
  )
  const expressionDockContext = useMemo(() => {
    if (!expressionEditor) return null
    return buildExpressionDockContext({
      editor: expressionEditor,
      rows: propertyRows,
      compoundRows: compoundPropertyRows,
      preExpressionValues: preExpressionPropertyValues,
      propertyValues,
      expressions: propertyExpressions,
      currentGlobalFrame: globalFrame ?? itemFrom + currentFrame,
      fps,
      resolveExpressionReference,
      getPropertyLabel: (property) => getKeyframePropertyLabel(t, property),
    })
  }, [
    compoundPropertyRows,
    currentFrame,
    expressionEditor,
    fps,
    globalFrame,
    itemFrom,
    preExpressionPropertyValues,
    propertyExpressions,
    propertyRows,
    propertyValues,
    resolveExpressionReference,
    t,
  ])
  useEffect(() => {
    if (expressionEditor && !expressionDockContext) {
      setExpressionReferencePick(null)
      setExpressionEditor(null)
    }
  }, [expressionDockContext, expressionEditor, setExpressionEditor, setExpressionReferencePick])

  const expressionDockElement =
    expressionEditor && expressionDockContext ? (
      <DopesheetExpressionDock
        property={expressionDockContext.property}
        propertyLabel={expressionDockContext.propertyLabel}
        source={expressionEditor.source}
        enabled={expressionEditor.enabled}
        preExpressionDisplay={formatExpressionValue(expressionDockContext.preExpressionValue)}
        postExpressionDisplay={formatExpressionValue(expressionDockContext.postExpressionValue)}
        error={expressionDockContext.error}
        hasStoredExpression={expressionDockContext.hasStoredExpression}
        pickingReference={expressionReferencePick?.property === expressionDockContext.property}
        rootRef={expressionDockRef}
        textareaRef={expressionTextareaRef}
        onSourceChange={(source, selectionStart, selectionEnd) =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, source, selectionStart, selectionEnd }
              : current,
          )
        }
        onSelectionChange={(selectionStart, selectionEnd) =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, selectionStart, selectionEnd }
              : current,
          )
        }
        onToggleEnabled={() =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, enabled: !current.enabled }
              : current,
          )
        }
        onApplyPreset={(source) => applyExpressionPreset(expressionDockContext.property, source)}
        onReferencePointerDown={(event, selectionStart, selectionEnd) => {
          setExpressionReferencePick(null)
          beginExpressionReferenceDrag(event, {
            itemId,
            property: expressionDockContext.property,
            selectionStart,
            selectionEnd,
          })
        }}
        onToggleReferencePicking={(selectionStart, selectionEnd) =>
          setExpressionReferencePick((current) =>
            current?.property === expressionDockContext.property
              ? null
              : {
                  itemId,
                  property: expressionDockContext.property,
                  selectionStart,
                  selectionEnd,
                },
          )
        }
        onRemove={() => {
          onRemovePropertyExpression?.(expressionDockContext.property)
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
        onCancel={() => {
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
        onApply={() => {
          if (expressionDockContext.error) return
          onSetPropertyExpression?.(
            expressionDockContext.property,
            expressionEditor.source,
            expressionEditor.enabled,
          )
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
      />
    ) : null

  // The row controls are substantially heavier than the timeline cells, and
  // their output does not depend on the time viewport. The hook caches those
  // nodes next to the elements it builds, so zooming only reconciles
  // keyframe/tick geometry.
  const { rowElements, propertyColumnElements } = useDopesheetSheetRows({
    rowContentProps,
    groupHeaderProps,
    renderedSheetEntries,
    groupTimelineById,
    groupedPropertyRows,
    expandedGroups,
    inlinePropertyGroupIdSet,
    rowKeyframesByProperty,
    renderedKeyframeXById,
    proceduralBandByProperty,
    selectedKeyframeIds,
    transitionBlockedRanges,
    ticks,
    frameToX,
    sharedGridFrameToX,
    getRenderedKeyframeX,
    effectiveTimelineWidth,
    timelineGridDivisions,
    propertyGridStyle,
    presentation,
    disabled,
    isPropertyLocked,
    itemId,
    textMotionBands,
    getLiveDragPixelsPerFrame,
    sheetPreviewFrames,
    sheetPreviewDuplicateKeyframeIds,
    keyframeMetaByIdRef,
    setKeyframeButtonRef,
    handleRowPointerDown,
    handleTimelineBackgroundPointerDown,
    handleKeyframePointerDown,
    handleGroupKeyframePointerDown,
    onSegmentEasingChange,
    onDragStart,
    onDragEnd,
    textMotionHandlers: {
      onDurationDragStart: onTextMotionDurationDragStart,
      onDurationCommit: onTextMotionDurationCommit,
      onDurationCancel: onTextMotionDurationCancel,
      onOffsetDragStart: onTextMotionOffsetDragStart,
      onOffsetCommit: onTextMotionOffsetCommit,
      onOffsetCancel: onTextMotionOffsetCancel,
      onBandClick: onTextMotionBandClick,
    },
  })
  const emptyStateMessage = hasPropertyFilters
    ? t('timeline.keyframeEditor.noParametersMatch')
    : t('timeline.keyframeEditor.noKeyframesToDisplay')
  const showEmptyGuidance = !hasPropertyFilters
  // A clip can be animated by procedural modulators / audio pulse yet have no
  // keyframes — the sheet would otherwise look empty and "unanimated".
  const proceduralHint =
    showEmptyGuidance && hasProceduralMotion
      ? t('timeline.keyframeEditor.proceduralMotionHint')
      : undefined

  // Hoisted so the graph pane and sheet body can be composed once and reused
  // across the exclusive (`graph`/`dopesheet`) and the `split` placements.
  const rulerHeaderElement = (
    <DopesheetRulerHeader
      propertyGridStyle={propertyGridStyle}
      timelineRef={timelineRef}
      onRulerPointerDown={handleRulerPointerDown}
      onRulerPointerMove={handleRulerPointerMove}
      onRulerPointerUp={handleRulerPointerUp}
      onRulerPointerLeave={handleRulerPointerLeave}
      ticks={ticks}
      frameToX={frameToX}
      fps={fps}
      rulerUnit={graphRulerUnit}
      rulerLabelFrameOffset={rulerLabelFrameOffset}
      liveRulerCanvas={liveRulerCanvas}
      reservedRightGutterWidth={reservedScrollbarGutterWidth}
      propertyFilter={filterKeyframedOnly ? 'keyframed' : 'all'}
      onPropertyFilterChange={
        presentation === 'classic' && propertyFilter === undefined
          ? (filter) => setShowKeyframedOnly(filter === 'keyframed')
          : undefined
      }
    />
  )
  // Standalone cells begin after their 1px border. A linked Edit axis pulls its
  // cell surfaces over that border, so its playhead must begin at the shared
  // main-timeline origin too.
  const timelineContentLeft = columnWidth + (hasLinkedTimelineAxis ? 0 : 1)
  const playheadOverlayElement = showPlayhead ? (
    <DopesheetPlayheadOverlay
      variant="sheet"
      left={timelineContentLeft}
      playheadFrame={playheadFrame}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  // Split view: one playhead element spans the ruler, sheet, and graph panes.
  // The graph's own line is hidden via `hidePlayhead`.
  const splitPlayheadOverlayElement = showPlayhead ? (
    <DopesheetPlayheadOverlay
      variant="split"
      left={timelineContentLeft}
      playheadFrame={playheadFrame}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  const skimPlayheadOverlayElement = onSkim ? (
    <DopesheetPlayheadOverlay
      variant="skim"
      left={timelineContentLeft}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  const sheetBodyElement = (
    <DopesheetSheetBody
      scrollAreaRef={scrollAreaRef}
      // Classic also lists text-motion bands, so bands alone give the body rows.
      hasRows={sheetRows.length > 0 || (presentation === 'classic' && textMotionBands.length > 0)}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      rowElements={rowElements}
      marqueeOverlayRef={marqueeOverlayRef}
      propertyColumnWidth={columnWidth}
      subtractRulerHeight={presentation !== 'lanes'}
      onTimelineBackgroundPointerDown={handleTimelineBackgroundPointerDown}
    />
  )
  const graphPaneElement = (
    <DopesheetGraphPane
      hasRows={propertyRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      propertyColumnElements={propertyColumnElements}
      propertyColumnWidth={columnWidth}
      graphPaneRef={graphPaneRef}
      disabled={disabled}
      graphDisplayPropertyLocked={graphDisplayPropertyLocked}
      focusGraphPane={focusGraphPane}
      handleGraphPaneKeyDown={handleGraphPaneKeyDown}
      graphPaneSize={graphPaneSize}
      graphVisiblePropertiesSize={visibleGraphProperties.length}
      viewport={viewport}
      updateViewport={updateViewport}
      itemId={itemId}
      keyframesByProperty={keyframesByProperty}
      graphDisplayProperty={graphDisplayProperty}
      graphVisibleProperties={resolveGraphVisiblePropertyList(
        singleCurveMode,
        graphDisplayProperty,
        compoundSecondaryProperties,
        visibleGraphProperties,
      )}
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
      proceduralPreview={proceduralPreview}
      snapEnabled={snapEnabled}
      graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
      graphRulerUnit={graphRulerUnit}
      autoZoomGraphHeight={autoZoomGraphHeight}
      graphVerticalZoomValue={graphVerticalZoomValue}
      hidePlayhead={!showPlayhead || isSplitView}
      subtractRulerHeight={presentation !== 'lanes'}
      customGraphContent={graphMode === 'speed' ? speedGraphContent : undefined}
    />
  )
  const affectedFrameRangeOverlayElement =
    affectedFrameRange && affectedFrameRangeGeometry ? (
      <div
        data-testid="dopesheet-affected-frame-range"
        data-from-frame={affectedFrameRange.fromFrame}
        data-to-frame={affectedFrameRange.toFrame}
        data-dopesheet-from-frame={affectedFrameRange.fromFrame}
        data-dopesheet-to-frame={affectedFrameRange.toFrame}
        className="absolute inset-y-0 border-x border-foreground/[0.10] bg-foreground/[0.035]"
        style={affectedFrameRangeGeometry}
      />
    ) : null

  // The workspace toolbar and the classic shell render the same header frame
  // inputs, so both build them from one source.
  const headerFrameInputs = {
    disabled,
    inputsEnabled:
      Boolean(onKeyframeMove) &&
      selectedFrameSummary.hasSelection &&
      !selectedFrameSummary.hasMixedFrames,
    totalFrames,
    globalFrame,
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  }

  if (presentation === 'lanes') {
    return (
      <DopesheetLanesPresentation
        pickWhipRootRef={pickWhipRootRef}
        className={className}
        height={height}
        disabled={disabled}
        handleWheel={handleWheel}
        handleGraphPaneKeyDown={handleGraphPaneKeyDown}
        timelineRef={timelineRef}
        timelineGridDivisions={timelineGridDivisions}
        timelineCellBorderWidth={timelineCellBorderWidth}
        columnWidth={columnWidth}
        showSheetPane={showSheetPane}
        showGraphPane={showGraphPane}
        graphPaneElement={graphPaneElement}
        sheetBodyElement={sheetBodyElement}
        skimPlayheadOverlayElement={skimPlayheadOverlayElement}
        playheadOverlayElement={playheadOverlayElement}
        expressionDockElement={expressionDockElement}
        expressionReferenceDrag={expressionReferenceDrag}
      />
    )
  }

  if (presentation === 'classic') {
    return (
      <DopesheetClassicPresentation
        pickWhipRootRef={pickWhipRootRef}
        className={className}
        height={height}
        width={width}
        disabled={disabled}
        t={t}
        keyframeCount={visibleKeyframes.length}
        trimmedKeyframeCount={trimmedKeyframeCount}
        onTrimAnimation={onTrimAnimation}
        headerFrameInputs={headerFrameInputs}
        viewportInteractionEnabled={viewportInteractionEnabled}
        handleWheel={handleWheel}
        affectedFrameRangeOverlayElement={affectedFrameRangeOverlayElement}
        effectiveTimelineWidth={effectiveTimelineWidth}
        columnWidth={columnWidth}
        skimPlayheadOverlayElement={skimPlayheadOverlayElement}
        playheadOverlayElement={playheadOverlayElement}
        rulerHeaderElement={rulerHeaderElement}
        sheetBodyElement={sheetBodyElement}
      />
    )
  }

  // Workspace chrome: only the default shell renders these, so they are built
  // after the two exclusive shells have already returned.
  const { inputsEnabled: headerFrameInputsEnabled, ...headerFrameInputProps } = headerFrameInputs
  const toolbarElement = (
      <DopesheetToolbar
        hasAvailableProperties={availableProperties.length > 0}
        filterKeyframedOnly={filterKeyframedOnly}
        onToggleKeyframedOnly={() => setShowKeyframedOnly((prev) => !prev)}
        allPropertyGroups={allPropertyGroups}
        visibleGroups={visibleGroups}
        onToggleVisibleGroup={toggleVisibleGroup}
        onExpandAllGroups={() => setAllGroupsExpanded(true)}
        onCollapseAllGroups={() => setAllGroupsExpanded(false)}
        onResetParameterView={resetParameterView}
        hasPropertyFilters={hasPropertyFilters}
        showGraphPane={showGraphPane}
        graphDisplayProperty={graphDisplayProperty}
        compoundPropertyRows={compoundPropertyRows}
        speedGraphContent={speedGraphContent}
        onGraphModeChange={onGraphModeChange}
        graphMode={graphMode}
        keyframeCount={visibleKeyframes.length}
        isCurrentFrameBlocked={isCurrentFrameBlocked}
        canBakeMotion={canBakeMotion}
        onBakeMotion={onBakeMotion}
        headerFrameInputsEnabled={headerFrameInputsEnabled}
        {...headerFrameInputProps}
        interpolationOptions={interpolationOptions}
        selectedInterpolation={selectedInterpolation}
        interpolationDisabled={interpolationDisabled}
        onInterpolationChange={onInterpolationChange}
        hasSelection={selectedRefs.length > 0}
        hasKeyframeClipboard={hasKeyframeClipboard}
        isKeyframeClipboardCut={isKeyframeClipboardCut}
        onCopyKeyframes={onCopyKeyframes}
        onCutKeyframes={onCutKeyframes}
        onPasteKeyframes={onPasteKeyframes}
        removeKeyframesAvailable={Boolean(onRemoveKeyframes)}
        handleRemoveKeyframes={handleRemoveKeyframes}
        horizontalZoomValue={horizontalZoomValue}
        horizontalZoomRatioBase={horizontalZoomRatioBase}
        setHorizontalZoomValue={setHorizontalZoomValue}
        resetViewport={resetViewport}
        graphVerticalZoomValue={graphVerticalZoomValue}
        graphPropertyCount={visibleGraphProperties.length}
        verticalZoomRatioBase={verticalZoomRatioBase}
        setGraphVerticalZoomValue={setGraphVerticalZoomValue}
        graphRulerUnit={graphRulerUnit}
        onChangeRulerUnit={setGraphRulerUnit}
        showAllGraphHandles={showAllGraphHandles}
        onToggleGraphHandleVisibility={() => setShowAllGraphHandles((prev) => !prev)}
        autoZoomGraphHeight={autoZoomGraphHeight}
        onToggleAutoZoomGraphHeight={() => setAutoZoomGraphHeight((prev) => !prev)}
      />
  )
  const timingStripElement = showGraphPane ? (
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
  ) : null
  const navigatorElement = (
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
  )
  return (
    <DopesheetEditorPresentation
      pickWhipRootRef={pickWhipRootRef}
      className={className}
      height={height}
      width={width}
      disabled={disabled}
      t={t}
      visualizationMode={visualizationMode}
      isSplitView={isSplitView}
      showSheetPane={showSheetPane}
      showGraphPane={showGraphPane}
      handleWheel={handleWheel}
      propertyGridStyle={propertyGridStyle}
      toolbarElement={toolbarElement}
      rulerHeaderElement={rulerHeaderElement}
      sheetBodyElement={sheetBodyElement}
      graphPaneElement={graphPaneElement}
      playheadOverlayElement={playheadOverlayElement}
      splitPlayheadOverlayElement={splitPlayheadOverlayElement}
      skimPlayheadOverlayElement={skimPlayheadOverlayElement}
      expressionDockElement={expressionDockElement}
      expressionReferenceDrag={expressionReferenceDrag}
      timingStripElement={timingStripElement}
      navigatorElement={navigatorElement}
    />
  )
})
