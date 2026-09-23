/**
 * Dopesheet workspace chrome.
 * The toolbar, the timing strip and the navigator belong to the default
 * workspace shell only, so they are built after the exclusive (`lanes` and
 * `classic`) shells have already returned: those modes allocate none of this.
 */

import type { ComponentProps, CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import { CompactNavigator } from './compact-navigator'
import { DopesheetToolbar } from './dopesheet-toolbar'
import { KeyframeTimingStrip } from './keyframe-timing-strip'
import type { DopesheetHeaderFrameInputsProps } from './dopesheet-presentation'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import type { UseDopesheetSheetStructureReturn } from './use-dopesheet-sheet-structure'
import type { UseDopesheetSelectionMetaReturn } from './use-dopesheet-selection-meta'

type ToolbarProps = ComponentProps<typeof DopesheetToolbar>
type TimingStripProps = ComponentProps<typeof KeyframeTimingStrip>
type NavigatorProps = ComponentProps<typeof CompactNavigator>

/** Everything the workspace chrome reads, from the editor's resolved state. */
export interface DopesheetWorkspaceChromeState {
  // Toolbar
  availableProperties: AnimatableProperty[]
  filterKeyframedOnly: boolean
  setShowKeyframedOnly: Dispatch<SetStateAction<boolean>>
  allPropertyGroups: ToolbarProps['allPropertyGroups']
  visibleGroups: ToolbarProps['visibleGroups']
  toggleVisibleGroup: ToolbarProps['onToggleVisibleGroup']
  setAllGroupsExpanded: (expanded: boolean) => void
  resetParameterView: () => void
  hasPropertyFilters: boolean
  showGraphPane: boolean
  graphDisplayProperty: ToolbarProps['graphDisplayProperty']
  compoundPropertyRows: ToolbarProps['compoundPropertyRows']
  speedGraphContent: ToolbarProps['speedGraphContent']
  onGraphModeChange: ToolbarProps['onGraphModeChange']
  graphMode: ToolbarProps['graphMode']
  visibleKeyframes: UseDopesheetSheetStructureReturn['visibleKeyframes']
  isCurrentFrameBlocked: boolean
  canBakeMotion: boolean
  onBakeMotion: ToolbarProps['onBakeMotion']
  interpolationOptions: ToolbarProps['interpolationOptions']
  selectedInterpolation: ToolbarProps['selectedInterpolation']
  interpolationDisabled: boolean
  onInterpolationChange: ToolbarProps['onInterpolationChange']
  selectedRefs: UseDopesheetSelectionMetaReturn['selectedRefs']
  hasKeyframeClipboard: boolean
  isKeyframeClipboardCut: boolean
  onCopyKeyframes: ToolbarProps['onCopyKeyframes']
  onCutKeyframes: ToolbarProps['onCutKeyframes']
  onPasteKeyframes: ToolbarProps['onPasteKeyframes']
  onRemoveKeyframes: DopesheetEditorProps['onRemoveKeyframes']
  handleRemoveKeyframes: ToolbarProps['handleRemoveKeyframes']
  horizontalZoomValue: number
  horizontalZoomRatioBase: number
  setHorizontalZoomValue: ToolbarProps['setHorizontalZoomValue']
  resetViewport: () => void
  graphVerticalZoomValue: number
  visibleGraphProperties: AnimatableProperty[]
  verticalZoomRatioBase: number
  setGraphVerticalZoomValue: ToolbarProps['setGraphVerticalZoomValue']
  graphRulerUnit: ToolbarProps['graphRulerUnit']
  setGraphRulerUnit: ToolbarProps['onChangeRulerUnit']
  showAllGraphHandles: boolean
  setShowAllGraphHandles: Dispatch<SetStateAction<boolean>>
  autoZoomGraphHeight: boolean
  setAutoZoomGraphHeight: Dispatch<SetStateAction<boolean>>
  headerFrameInputs: DopesheetHeaderFrameInputsProps
  // Timing strip + navigator
  propertyGridStyle: CSSProperties
  viewport: TimingStripProps['viewport']
  contentFrameMax: number
  timingStripMarkers: TimingStripProps['markers']
  timingStripPreviewFrames: TimingStripProps['previewFrames']
  disabled: boolean
  handleTimingStripSelectionChange: TimingStripProps['onSelectionChange']
  handleTimingStripSlideStart: TimingStripProps['onSlideStart']
  handleTimingStripSlideChange: TimingStripProps['onSlideChange']
  handleTimingStripSlideEnd: TimingStripProps['onSlideEnd']
  currentFrame: number
  minViewportFrames: number
  updateViewport: NavigatorProps['onViewportChange']
}

/** The elements the workspace shell places around the panes. */
export interface DopesheetWorkspaceChrome {
  toolbarElement: ReactNode
  timingStripElement: ReactNode
  navigatorElement: ReactNode
}

/** Builds the workspace-only chrome from one state object. */
export function buildDopesheetWorkspaceChrome(
  state: DopesheetWorkspaceChromeState,
): DopesheetWorkspaceChrome {
  const {
    availableProperties,
    filterKeyframedOnly,
    setShowKeyframedOnly,
    allPropertyGroups,
    visibleGroups,
    toggleVisibleGroup,
    setAllGroupsExpanded,
    resetParameterView,
    hasPropertyFilters,
    showGraphPane,
    graphDisplayProperty,
    compoundPropertyRows,
    speedGraphContent,
    onGraphModeChange,
    graphMode,
    visibleKeyframes,
    isCurrentFrameBlocked,
    canBakeMotion,
    onBakeMotion,
    interpolationOptions,
    selectedInterpolation,
    interpolationDisabled,
    onInterpolationChange,
    selectedRefs,
    hasKeyframeClipboard,
    isKeyframeClipboardCut,
    onCopyKeyframes,
    onCutKeyframes,
    onPasteKeyframes,
    onRemoveKeyframes,
    handleRemoveKeyframes,
    horizontalZoomValue,
    horizontalZoomRatioBase,
    setHorizontalZoomValue,
    resetViewport,
    graphVerticalZoomValue,
    visibleGraphProperties,
    verticalZoomRatioBase,
    setGraphVerticalZoomValue,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    headerFrameInputs,
    propertyGridStyle,
    viewport,
    contentFrameMax,
    timingStripMarkers,
    timingStripPreviewFrames,
    disabled,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
    currentFrame,
    minViewportFrames,
    updateViewport,
  } = state

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
  return { toolbarElement, timingStripElement, navigatorElement }
}
