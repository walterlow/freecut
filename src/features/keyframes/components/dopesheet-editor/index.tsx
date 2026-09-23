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
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'

import { useGraphViewState } from './use-graph-view-state'
import { useHeaderFrameInputs } from './use-header-frame-inputs'
import { usePropertyFilters } from './use-property-filters'
import { useRulerScrub } from './use-ruler-scrub'
import { useDopesheetMarquee } from './use-dopesheet-marquee'
import { useDopesheetViewport } from './use-dopesheet-viewport'
import { useDopesheetPropertyDerivations } from './use-dopesheet-property-derivations'
import { useDopesheetNavigation } from './use-dopesheet-navigation'
import { useDopesheetSheetMetrics } from './use-dopesheet-sheet-metrics'
import { useDopesheetCoordinates } from './use-dopesheet-coordinates'
import { useDopesheetSelectionMeta } from './use-dopesheet-selection-meta'
import { useDopesheetGraphDisplay } from './use-dopesheet-graph-display'
import { useDopesheetSheetStructure } from './use-dopesheet-sheet-structure'
import { useDopesheetExpressionDock } from './use-dopesheet-expression-dock'
import { useDopesheetFrameTargets } from './use-dopesheet-frame-targets'
import { useDopesheetRowProps } from './use-dopesheet-row-props'
import { useDopesheetTimingStrip } from './use-dopesheet-timing-strip'
import { useDopesheetSheetRows } from './use-dopesheet-sheet-rows'
import {
  useDopesheetPointerDispatch,
  useLinkedTimelineWheelForwarding,
} from './use-dopesheet-pointer-dispatch'
import { useSelectionFrameActions } from './use-selection-frame-actions'
import { usePropertyValueEditing } from './use-property-value-editing'
import { useDopesheetRowActions } from './use-dopesheet-row-actions'
import { useElementSize } from './use-element-size'
import { useKeyframeDrag } from './use-keyframe-drag'
import { useSheetPreviewDom } from './sheet-preview-dom'
import {
  DopesheetClassicPresentation,
  DopesheetEditorPresentation,
  DopesheetLanesPresentation,
} from './dopesheet-presentation'
import { useLivePixelGeometrySync } from './use-live-pixel-geometry-sync'

import { perfMarkRender } from '@/shared/logging/perf-marks'
import {
} from '@/shared/timeline/main-timeline-scrub'

import { useDopesheetHotkeys } from './use-dopesheet-hotkeys'
import { usePropertyExpressionEditor } from './use-property-expression-editor'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import {
  buildDopesheetAffectedFrameRangeOverlayElement,
  buildDopesheetGraphPaneElement,
  buildDopesheetHeaderFrameInputs,
  buildDopesheetSheetPaneElements,
} from './dopesheet-pane-elements'
import { buildDopesheetWorkspaceChrome } from './dopesheet-workspace-chrome'

import {
} from '@/features/keyframes/deps/timeline-playhead'
import {
  EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
  PROPERTY_COLUMN_WIDTH,
  SPACIOUS_PROPERTY_COLUMN_WIDTH,
} from './dopesheet-constants'
import type { DragState } from './dopesheet-types'
import {
  PROPERTY_VALUE_RANGES,
  isColorAnimatableProperty,
} from '@/features/keyframes/property-value-ranges'
import { keyframeValueToHexColor } from '@/features/keyframes/utils/color-keyframes'
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store'
import type { DopesheetEditorProps } from './dopesheet-editor-props'


// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_PROPERTY_GROUP_IDS: readonly string[] = []
const EMPTY_HIDDEN_PROPERTIES: readonly AnimatableProperty[] = []
const EMPTY_COMPOUND_ROWS: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>> = {}
const EMPTY_COMPOUND_SECONDARIES: Partial<Record<AnimatableProperty, AnimatableProperty>> = {}
const EMPTY_DIMENSION_SEPARATION: NonNullable<
  DopesheetEditorProps['dimensionSeparationByProperty']
> = {}


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

  const {
    availableProperties,
    hiddenPropertyRowSet,
    graphableProperties,
    allPropertyGroups,
    inlinePropertyGroupIdSet,
    propertyGroupIdByProperty,
    keyframedPropertyIds,
    proceduralBandByProperty,
  } = useDopesheetPropertyDerivations({
    keyframesByProperty,
    hiddenPropertyRows,
    inlinePropertyGroupIds,
    motionModifiers,
    proceduralDurationInFrames,
    proceduralFrameOffset,
  })
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
  const {
    filterKeyframedOnly,
    visibleProperties,
    propertyColumnProperties,
    activeSelectedProperty,
    hasPropertyFilters,
    sheetKeyframesByProperty,
    sheetRowsStructure,
    groupTimelineById,
    sheetRows,
    groupedSheetRows,
    propertyRowByProperty,
    visibleKeyframes,
    expandedGroups,
    toggleGroup,
    setAllGroupsExpanded,
  } = useDopesheetSheetStructure({
    availableProperties,
    hiddenPropertyRowSet,
    propertyGroupIdByProperty,
    keyframedPropertyIds,
    proceduralBandByProperty,
    visibleGroups,
    propertyFilter,
    showKeyframedOnly,
    resolvedPropertyLinks,
    keyframesByProperty,
    currentFrame,
    selectedProperty,
    allPropertyGroups,
    initialExpandedGroups,
    onExpandedGroupsChange,
  })
  const propertyRows = sheetRows
  const groupedPropertyRows = groupedSheetRows

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

  const {
    keyframeMetaById,
    keyframeMetaByIdRef,
    selectedFrameSummary,
    selectedCurveProperty,
    selectedRefs,
    selectedRefIds,
  } = useDopesheetSelectionMeta({
    sheetRowsStructure,
    selectedKeyframeIds,
    currentFrame,
    globalFrame,
    isPropertyLocked,
    itemId,
  })

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


  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const {
    horizontalZoomRatioBase,
    horizontalZoomValue,
    reservedScrollbarGutterWidth,
    hasLinkedTimelineAxis,
    timelineCellBorderWidth,
    effectiveTimelineWidth,
    timelineEdgeInset,
    timelinePixelsPerSecond,
    propertyGridStyle,
    getLiveDragPixelsPerFrame,
  } = useDopesheetSheetMetrics({
    width,
    columnWidth,
    timelineWidth,
    sheetScrollWidth,
    showSheetPane,
    presentation,
    linkedTimelineViewportWidth,
    frameRange,
    fps,
    contentFrameMax,
    minViewportFrames,
    getTimelineLivePixelsPerSecond,
  })

  useLivePixelGeometrySync({
    syncLivePixelGeometryRef,
    rootRef: pickWhipRootRef,
    timelineScrollContainerRef,
    getTimelineLivePixelsPerSecond,
    timelinePanBaseScrollLeft,
    timelinePanBasePixelsPerSecond,
    timelinePixelsPerSecond,
    fps,
    itemFrom,
    hasLinkedTimelineAxis,
  })

  const {
    frameToX,
    affectedFrameRangeGeometry,
    sharedGridFrameToX,
    getRenderedKeyframeX,
    renderedKeyframeXById,
    renderedSheetEntries,
    getKeyframePoints,
    getFrameFromClientX,
    getTimelineXFromClientX,
    getContentYFromClientY,
    ticks,
  } = useDopesheetCoordinates({
    viewport,
    effectiveTimelineWidth,
    timelineEdgeInset,
    timelineCellBorderWidth,
    timelineGridDivisions,
    timelineScrollContainerRef,
    sheetRowsStructure,
    groupedSheetRows,
    presentation,
    textMotionBandCount: textMotionBands.length,
    inlinePropertyGroupIdSet,
    expandedGroups,
    isPropertyLocked,
    affectedFrameRange,
    timelineRef,
    scrollAreaRef,
    currentFrame,
    scrubClampToItemBounds,
    scrubFrameBounds,
    totalFrames,
    frameRange,
  })

  useLayoutEffect(() => {
    if (presentation !== 'lanes') return
    onLaneContentHeightChange?.(renderedSheetEntries.contentHeight)
  }, [onLaneContentHeightChange, presentation, renderedSheetEntries.contentHeight])

  const { snapFrame, isCurrentFrameBlocked, notifyKeyframeBlocked } = useDopesheetFrameTargets({
    visibleKeyframes,
    selectedKeyframeIds,
    additionalSnapFrames,
    currentFrame,
    effectiveTimelineWidth,
    frameRange,
    transitionBlockedRanges,
  })

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


  const {
    canClearRow,
    activateProperty,
    showSinglePropertyCurve,
    handleClearProperty,
    handleClearGroup,
    handleRowToggleKeyframe,
    handleRowAddKeyframe,
    handleRowAutoKeyToggle,
    nudgeSelectedKeyframes,
  } = useDopesheetRowActions({
    disabled,
    isPropertyLocked,
    itemId,
    currentFrame,
    isCurrentFrameBlocked,
    notifyKeyframeBlocked,
    propertyRowByProperty,
    selectedKeyframeIds,
    showGraphPane,
    singleCurveMode,
    setGraphVisibleProperties,
    onCurveVisibilityChange,
    onPropertyChange,
    onActivePropertyChange,
    onRemoveKeyframes,
    onSelectionChange,
    onAddKeyframe,
    toggleAutoKeyframeEnabled,
    moveSelectedKeyframesByDelta,
  })

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


  const activePropertyRow = selectedProperty
    ? propertyRowByProperty.get(selectedProperty)
    : undefined
  useDopesheetHotkeys({
    shortcutsEnabled,
    addKeyframeShortcutEnabled,
    disabled,
    shortcuts,
    activePropertyRow,
    hasSelection: selectedRefs.length > 0,
    canCommitValues: Boolean(onPropertyValueCommit),
    selectedRefs,
    onRemoveKeyframes,
    handleRowAddKeyframe,
    handleRowNavigate,
    handleRowAutoKeyToggle,
    fitKeyframesInView,
    nudgeSelectedKeyframes,
  })

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

  const {
    visibleGraphProperties,
    verticalZoomRatioBase,
    graphDisplayProperty,
    graphDisplayPropertyLocked,
    focusGraphPane,
    handleGraphPaneKeyDown,
  } = useDopesheetGraphDisplay({
    graphPaneRef,
    graphVisibleProperties,
    compoundSecondaryProperties,
    graphableProperties,
    keyframesByProperty,
    autoZoomGraphHeight,
    activeSelectedProperty,
    isPropertyLocked,
    disabled,
    selectedRefs,
    nudgeSelectedKeyframes,
    onRemoveKeyframes,
  })
  const {
    timingStripMarkers,
    constrainGraphFrameDelta,
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  } = useDopesheetTimingStrip({
    showGraphPane,
    showSheetPane,
    activeSelectedProperty,
    keyframesByProperty,
    visibleKeyframes,
    selectedKeyframeIds,
    selectedRefIds,
    isPropertyLocked,
    onKeyframeMove,
    disabled,
    totalFrames,
    onSelectionChange,
    onDragStart,
    onDragEnd,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    scheduleDragPreviewFrames,
  })
  // Shared row and group-header bundles, built once per change by the hook.
  const { rowContentProps, groupHeaderProps } = useDopesheetRowProps({
  activateProperty, axisConstraintByProperty, autoKeyEnabledByProperty,
  beginPropertyLink, canClearRow, compoundPropertyRows,
  compoundSecondaryProperties, itemId, itemFrom,
  currentFrame, fps, disabled,
  expressionEditor, formatPropertyValue, globalFrame,
  graphVisibleProperties, handleClearProperty, handleRowAutoKeyToggle,
  handleRowNavigate, handleRowToggleKeyframe, handleRowValueChange,
  handleRowValueCommit, handleValueScrubEnd, handleValueScrubCancel,
  handleValueScrubMove, handleValueScrubStart, isPropertyLocked,
  isCurrentFrameBlocked, onAddKeyframe, onNavigateToKeyframe,
  onCurveVisibilityChange, onDragCancel, onDragEnd,
  onDragStart, onPropertyValueCommit, onPropertyValuePreview,
  resolvedPropertyLinks, resolvedPropertyLinkSourceLabels, removePropertyLink,
  propertyExpressions, propertyLabels, preExpressionPropertyValues,
  resolveExpressionReference, onSetPropertyExpression, openPropertyExpressionEditor,
  onResetPropertiesToDefault, propertyValues, presentation,
  selectedProperty, selectedCurveVisibleExternally, setAllRowsLocked,
  setEditingValueProperty, setValueDrafts, showGraphPane,
  showSinglePropertyCurve, singleCurveMode, skipNextBlurCommitPropertyRef,
  spacious, t, togglePropertyCurve,
  toggleLockedProperty, valueDraftAtFocusRef, valueDrafts,
  expandedGroups, dimensionSeparationByProperty, setAllGroupsExpanded,
  setGroupLocked, toggleGroup, toggleGroupCurves,
  handleClearGroup,
  })
  const expressionDockElement = useDopesheetExpressionDock({
    editor: expressionEditor,
    referencePick: expressionReferencePick,
    dockRef: expressionDockRef,
    textareaRef: expressionTextareaRef,
    setEditor: setExpressionEditor,
    setReferencePick: setExpressionReferencePick,
    beginReferenceDrag: beginExpressionReferenceDrag,
    applyPreset: applyExpressionPreset,
    itemId,
    rows: propertyRows,
    compoundRows: compoundPropertyRows,
    preExpressionValues: preExpressionPropertyValues,
    propertyValues,
    expressions: propertyExpressions,
    currentFrame,
    globalFrame,
    itemFrom,
    fps,
    resolveExpressionReference,
    onSetPropertyExpression,
    onRemovePropertyExpression,
  })

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
  const paneState = {
    t, hasPropertyFilters, hasProceduralMotion,
    propertyGridStyle, timelineRef, graphRulerUnit, reservedScrollbarGutterWidth,
    ticks, frameToX, handleRulerPointerDown, handleRulerPointerMove,
    handleRulerPointerUp, handleRulerPointerLeave, filterKeyframedOnly,
    setShowKeyframedOnly, presentation, propertyFilter, hasLinkedTimelineAxis,
    timelineScrollContainerRef, getTimelineLivePixelsPerSecond,
    timelinePixelsPerSecond, itemFrom, columnWidth, showPlayhead, onSkim,
    playheadFrame, currentFrame, totalFrames, playheadClampToItemBounds,
    globalFrameToPixels, rulerScrubActiveRef, rulerScrubHandoffFrameRef,
    effectiveTimelineWidth, fps, isRulerScrubbing, scrollAreaRef, sheetRows,
    textMotionBands, rowElements, marqueeOverlayRef,
    handleTimelineBackgroundPointerDown, propertyColumnElements, graphPaneRef,
    disabled, graphDisplayPropertyLocked, focusGraphPane, handleGraphPaneKeyDown,
    graphPaneSize, visibleGraphProperties, viewport, updateViewport, itemId,
    keyframesByProperty, graphDisplayProperty, singleCurveMode,
    compoundSecondaryProperties, selectedKeyframeIds, onKeyframeMove,
    timingStripPreviewFrames, constrainGraphFrameDelta, onBezierHandleMove,
    onSelectionChange, onPropertyChange, onScrub, onScrubStart, onScrubEnd,
    onDragStart, onDragEnd, onAddKeyframe, onRemoveKeyframes,
    onNavigateToKeyframe, transitionBlockedRanges, proceduralPreview,
    snapEnabled, showAllGraphHandles, autoZoomGraphHeight,
    graphVerticalZoomValue, isSplitView, graphMode, speedGraphContent,
    affectedFrameRange, affectedFrameRangeGeometry, selectedFrameSummary,
    globalFrame, localFrameInputValue, globalFrameInputValue,
    setLocalFrameInputValue, setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef, commitLocalFrameInput, commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  }
  const {
    rulerHeaderElement, sheetBodyElement, playheadOverlayElement,
    splitPlayheadOverlayElement, skimPlayheadOverlayElement,
  } = buildDopesheetSheetPaneElements(paneState)
  const graphPaneElement = buildDopesheetGraphPaneElement(paneState)
  const affectedFrameRangeOverlayElement =
    buildDopesheetAffectedFrameRangeOverlayElement(paneState)
  const headerFrameInputs = buildDopesheetHeaderFrameInputs(paneState)

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
  const chromeState = {
    propertyGridStyle, viewport, contentFrameMax, disabled, currentFrame,
    minViewportFrames, updateViewport, timingStripMarkers,
    timingStripPreviewFrames, handleTimingStripSelectionChange,
    handleTimingStripSlideStart, handleTimingStripSlideChange,
    handleTimingStripSlideEnd, headerFrameInputs, availableProperties,
    filterKeyframedOnly, setShowKeyframedOnly, allPropertyGroups, visibleGroups,
    toggleVisibleGroup, setAllGroupsExpanded, resetParameterView,
    hasPropertyFilters, showGraphPane, graphDisplayProperty, compoundPropertyRows,
    speedGraphContent, onGraphModeChange, graphMode, visibleKeyframes,
    isCurrentFrameBlocked, canBakeMotion, onBakeMotion, interpolationOptions,
    selectedInterpolation, interpolationDisabled, onInterpolationChange,
    selectedRefs, hasKeyframeClipboard, isKeyframeClipboardCut,
    onCopyKeyframes, onCutKeyframes, onPasteKeyframes, onRemoveKeyframes,
    handleRemoveKeyframes, horizontalZoomValue, horizontalZoomRatioBase,
    setHorizontalZoomValue, resetViewport, graphVerticalZoomValue,
    visibleGraphProperties, verticalZoomRatioBase, setGraphVerticalZoomValue,
    graphRulerUnit, setGraphRulerUnit, showAllGraphHandles, setShowAllGraphHandles,
    autoZoomGraphHeight, setAutoZoomGraphHeight,
  }
  const { toolbarElement, timingStripElement, navigatorElement } =
    buildDopesheetWorkspaceChrome(chromeState)
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
