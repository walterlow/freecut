/**
 * Dopesheet pane elements.
 * The editor derives the ruler, sheet, graph and header-frame state; this module
 * turns that state into the panes the presentation shells place, so the
 * exclusive (`dopesheet`/`graph`) modes and the `split` view compose the same
 * elements. Every pane stays a plain node rebuilt per render, exactly as it was
 * while this code lived in the editor: the panes own their own memoization, so
 * nothing here may be memoized on an injected value's identity.
 */

import type { ComponentProps, ReactNode, RefObject } from 'react'
import type { TFunction } from 'i18next'
import type { AnimatableProperty } from '@/types/keyframe'
import { DopesheetGraphPane } from './dopesheet-graph-pane'
import { DopesheetLiveRulerCanvas } from './dopesheet-live-ruler-canvas'
import { DopesheetRulerHeader } from './dopesheet-ruler-header'
import { DopesheetSheetBody } from './dopesheet-sheet-body'
import { buildDopesheetPlayheadElements } from './dopesheet-playhead-elements'
import type {
  DopesheetHeaderFrameInputsProps,
  DopesheetPaneElements,
} from './dopesheet-presentation'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import type { DopesheetPropertyRow } from './dopesheet-types'
import type { UseDopesheetSelectionMetaReturn } from './use-dopesheet-selection-meta'
import type { UseHeaderFrameInputsReturn } from './use-header-frame-inputs'

type RulerHeaderProps = ComponentProps<typeof DopesheetRulerHeader>
type SheetBodyProps = ComponentProps<typeof DopesheetSheetBody>
type GraphPaneProps = ComponentProps<typeof DopesheetGraphPane>

/** Everything the pane elements read: the editor's resolved props and derived state. */
export interface DopesheetPaneElementsState {
  // Empty-state copy
  t: TFunction
  hasPropertyFilters: boolean
  hasProceduralMotion: boolean
  // Ruler header
  propertyGridStyle: RulerHeaderProps['propertyGridStyle']
  timelineRef: RulerHeaderProps['timelineRef']
  handleRulerPointerDown: RulerHeaderProps['onRulerPointerDown']
  handleRulerPointerMove: RulerHeaderProps['onRulerPointerMove']
  handleRulerPointerUp: RulerHeaderProps['onRulerPointerUp']
  handleRulerPointerLeave: RulerHeaderProps['onRulerPointerLeave']
  ticks: RulerHeaderProps['ticks']
  frameToX: RulerHeaderProps['frameToX']
  graphRulerUnit: RulerHeaderProps['rulerUnit']
  reservedScrollbarGutterWidth: number
  filterKeyframedOnly: boolean
  setShowKeyframedOnly: (keyframedOnly: boolean) => void
  presentation: NonNullable<DopesheetEditorProps['presentation']>
  propertyFilter: DopesheetEditorProps['propertyFilter']
  hasLinkedTimelineAxis: boolean
  timelineScrollContainerRef: DopesheetEditorProps['timelineScrollContainerRef']
  getTimelineLivePixelsPerSecond: DopesheetEditorProps['getTimelineLivePixelsPerSecond']
  timelinePixelsPerSecond: number
  itemFrom: number
  // Playhead overlays
  columnWidth: number
  showPlayhead: boolean
  onSkim: DopesheetEditorProps['onSkim']
  playheadFrame: DopesheetEditorProps['playheadFrame']
  currentFrame: number
  totalFrames: number
  playheadClampToItemBounds: boolean
  globalFrameToPixels: DopesheetEditorProps['globalFrameToPixels']
  rulerScrubActiveRef: RefObject<boolean>
  rulerScrubHandoffFrameRef: RefObject<number | null>
  effectiveTimelineWidth: number
  fps: number
  isRulerScrubbing: boolean
  // Sheet body
  scrollAreaRef: RefObject<HTMLDivElement | null>
  sheetRows: DopesheetPropertyRow[]
  textMotionBands: NonNullable<DopesheetEditorProps['textMotionBands']>
  rowElements: ReactNode
  marqueeOverlayRef: RefObject<HTMLDivElement | null>
  handleTimelineBackgroundPointerDown: SheetBodyProps['onTimelineBackgroundPointerDown']
  // Graph pane
  propertyColumnElements: ReactNode
  graphPaneRef: RefObject<HTMLDivElement | null>
  disabled: boolean
  graphDisplayPropertyLocked: boolean
  focusGraphPane: GraphPaneProps['focusGraphPane']
  handleGraphPaneKeyDown: GraphPaneProps['handleGraphPaneKeyDown']
  graphPaneSize: GraphPaneProps['graphPaneSize']
  visibleGraphProperties: GraphPaneProps['graphVisibleProperties']
  viewport: GraphPaneProps['viewport']
  updateViewport: GraphPaneProps['updateViewport']
  itemId: DopesheetEditorProps['itemId']
  keyframesByProperty: DopesheetEditorProps['keyframesByProperty']
  graphDisplayProperty: GraphPaneProps['graphDisplayProperty']
  singleCurveMode: boolean
  compoundSecondaryProperties: NonNullable<DopesheetEditorProps['compoundSecondaryProperties']>
  selectedKeyframeIds: Set<string>
  onKeyframeMove: DopesheetEditorProps['onKeyframeMove']
  timingStripPreviewFrames: GraphPaneProps['timingStripPreviewFrames']
  constrainGraphFrameDelta: GraphPaneProps['constrainGraphFrameDelta']
  onBezierHandleMove: DopesheetEditorProps['onBezierHandleMove']
  onSelectionChange: DopesheetEditorProps['onSelectionChange']
  onPropertyChange: DopesheetEditorProps['onPropertyChange']
  onScrub: DopesheetEditorProps['onScrub']
  onScrubStart: DopesheetEditorProps['onScrubStart']
  onScrubEnd: DopesheetEditorProps['onScrubEnd']
  onDragStart: DopesheetEditorProps['onDragStart']
  onDragEnd: DopesheetEditorProps['onDragEnd']
  onAddKeyframe: DopesheetEditorProps['onAddKeyframe']
  onRemoveKeyframes: DopesheetEditorProps['onRemoveKeyframes']
  onNavigateToKeyframe: DopesheetEditorProps['onNavigateToKeyframe']
  transitionBlockedRanges: DopesheetEditorProps['transitionBlockedRanges']
  proceduralPreview: DopesheetEditorProps['proceduralPreview']
  snapEnabled: boolean
  showAllGraphHandles: boolean
  autoZoomGraphHeight: boolean
  graphVerticalZoomValue: number
  isSplitView: boolean
  graphMode: NonNullable<DopesheetEditorProps['graphMode']>
  speedGraphContent: DopesheetEditorProps['speedGraphContent']
  // Affected frame range overlay
  affectedFrameRange: DopesheetEditorProps['affectedFrameRange']
  affectedFrameRangeGeometry: { left: number; width: number } | null
  // Header frame inputs
  selectedFrameSummary: UseDopesheetSelectionMetaReturn['selectedFrameSummary']
  globalFrame: number | null
  localFrameInputValue: UseHeaderFrameInputsReturn['localFrameInputValue']
  globalFrameInputValue: UseHeaderFrameInputsReturn['globalFrameInputValue']
  setLocalFrameInputValue: UseHeaderFrameInputsReturn['setLocalFrameInputValue']
  setGlobalFrameInputValue: UseHeaderFrameInputsReturn['setGlobalFrameInputValue']
  skipNextHeaderFrameBlurRef: UseHeaderFrameInputsReturn['skipNextHeaderFrameBlurRef']
  commitLocalFrameInput: UseHeaderFrameInputsReturn['commitLocalFrameInput']
  commitGlobalFrameInput: UseHeaderFrameInputsReturn['commitGlobalFrameInput']
  handleHeaderFrameInputKeyDown: UseHeaderFrameInputsReturn['handleHeaderFrameInputKeyDown']
}

/** Copy for the sheet and graph empty states. */
function resolveDopesheetEmptyState(state: DopesheetPaneElementsState) {
  const { t, hasPropertyFilters, hasProceduralMotion } = state

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

  return { emptyStateMessage, showEmptyGuidance, proceduralHint }
}

/**
 * The sheet side of the editor: the ruler header (with its live canvas), the
 * playhead overlays and the sheet body, so the exclusive and split shells
 * compose the same nodes.
 */
export type DopesheetSheetPaneElements = Pick<
  DopesheetPaneElements,
  | 'rulerHeaderElement'
  | 'sheetBodyElement'
  | 'playheadOverlayElement'
  | 'splitPlayheadOverlayElement'
  | 'skimPlayheadOverlayElement'
>

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

export function buildDopesheetSheetPaneElements(
  state: DopesheetPaneElementsState,
): DopesheetSheetPaneElements {
  const {
    propertyGridStyle,
    timelineRef,
    handleRulerPointerDown,
    handleRulerPointerMove,
    handleRulerPointerUp,
    handleRulerPointerLeave,
    ticks,
    frameToX,
    graphRulerUnit,
    reservedScrollbarGutterWidth,
    filterKeyframedOnly,
    setShowKeyframedOnly,
    presentation,
    propertyFilter,
    hasLinkedTimelineAxis,
    timelineScrollContainerRef,
    getTimelineLivePixelsPerSecond,
    timelinePixelsPerSecond,
    itemFrom,
    columnWidth,
    showPlayhead,
    onSkim,
    playheadFrame,
    currentFrame,
    totalFrames,
    playheadClampToItemBounds,
    globalFrameToPixels,
    rulerScrubActiveRef,
    rulerScrubHandoffFrameRef,
    effectiveTimelineWidth,
    fps,
    isRulerScrubbing,
    scrollAreaRef,
    sheetRows,
    textMotionBands,
    rowElements,
    marqueeOverlayRef,
    handleTimelineBackgroundPointerDown,
  } = state

  const { emptyStateMessage, showEmptyGuidance, proceduralHint } = resolveDopesheetEmptyState(state)

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
  const {
    sheet: playheadOverlayElement,
    split: splitPlayheadOverlayElement,
    skim: skimPlayheadOverlayElement,
  } = buildDopesheetPlayheadElements({
    showPlayhead,
    skim: Boolean(onSkim),
    left: timelineContentLeft,
    playheadFrame,
    currentFrame,
    itemFrom,
    totalFrames,
    clampToItemBounds: playheadClampToItemBounds,
    localScrubActiveRef: rulerScrubActiveRef,
    localScrubHandoffFrameRef: rulerScrubHandoffFrameRef,
    frameToX,
    globalFrameToX: globalFrameToPixels,
    positionSyncTargetRef: timelineScrollContainerRef,
    maxLeft: effectiveTimelineWidth - 1,
    fps,
    isRulerScrubbing,
  })

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
  return {
    rulerHeaderElement,
    playheadOverlayElement,
    splitPlayheadOverlayElement,
    skimPlayheadOverlayElement,
    sheetBodyElement,
  }
}

/** The graph pane, sharing the sheet's empty-state copy. */
export function buildDopesheetGraphPaneElement(state: DopesheetPaneElementsState): ReactNode {
  const {
    graphRulerUnit,
    presentation,
    itemFrom,
    columnWidth,
    showPlayhead,
    currentFrame,
    totalFrames,
    fps,
    sheetRows,
    propertyColumnElements,
    graphPaneRef,
    disabled,
    graphDisplayPropertyLocked,
    focusGraphPane,
    handleGraphPaneKeyDown,
    graphPaneSize,
    visibleGraphProperties,
    viewport,
    updateViewport,
    itemId,
    keyframesByProperty,
    graphDisplayProperty,
    singleCurveMode,
    compoundSecondaryProperties,
    selectedKeyframeIds,
    onKeyframeMove,
    timingStripPreviewFrames,
    constrainGraphFrameDelta,
    onBezierHandleMove,
    onSelectionChange,
    onPropertyChange,
    onScrub,
    onScrubStart,
    onScrubEnd,
    onDragStart,
    onDragEnd,
    onAddKeyframe,
    onRemoveKeyframes,
    onNavigateToKeyframe,
    transitionBlockedRanges,
    proceduralPreview,
    snapEnabled,
    showAllGraphHandles,
    autoZoomGraphHeight,
    graphVerticalZoomValue,
    isSplitView,
    graphMode,
    speedGraphContent,
  } = state

  const { emptyStateMessage, showEmptyGuidance, proceduralHint } = resolveDopesheetEmptyState(state)

  const graphPaneElement = (
    <DopesheetGraphPane
      hasRows={sheetRows.length > 0}
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
  return graphPaneElement
}

/** The affected-frame-range band the classic shell places over the sheet. */
export function buildDopesheetAffectedFrameRangeOverlayElement(
  state: DopesheetPaneElementsState,
): ReactNode {
  const { affectedFrameRange, affectedFrameRangeGeometry } = state

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
  return affectedFrameRangeOverlayElement
}

/** Header frame inputs the workspace toolbar and the classic shell share. */
export function buildDopesheetHeaderFrameInputs(
  state: DopesheetPaneElementsState,
): DopesheetHeaderFrameInputsProps {
  const {
    totalFrames,
    disabled,
    onKeyframeMove,
    selectedFrameSummary,
    globalFrame,
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  } = state

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
  return headerFrameInputs
}
