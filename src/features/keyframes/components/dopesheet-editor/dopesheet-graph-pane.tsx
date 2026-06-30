import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import type {
  AnimatableProperty,
  BezierControlPoints,
  Keyframe,
  KeyframeRef,
} from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { ProceduralPreviewInput } from '@/features/keyframes/utils/procedural-preview'
import { EmbeddedValueGraphEditor } from '../value-graph-editor'
import { PROPERTY_COLUMN_WIDTH, RULER_HEIGHT } from './dopesheet-constants'
import { DopesheetEmptyState } from './dopesheet-empty-state'
import type { Viewport } from './dopesheet-types'

interface DopesheetGraphPaneProps {
  hasRows: boolean
  emptyStateMessage: string
  showEmptyGuidance: boolean
  proceduralHint?: string
  propertyColumnElements: ReactNode
  propertyColumnWidth?: number
  graphPaneRef: React.RefObject<HTMLDivElement | null>
  disabled: boolean
  graphDisplayPropertyLocked: boolean
  focusGraphPane: (
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
  ) => void
  handleGraphPaneKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  graphPaneSize: { width: number; height: number }
  graphVisiblePropertiesSize: number
  viewport: Viewport
  updateViewport: (next: Viewport) => void
  itemId: string
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  graphDisplayProperty: AnimatableProperty | null
  graphVisibleProperties: AnimatableProperty[]
  selectedKeyframeIds: Set<string>
  currentFrame: number
  itemFrom: number
  totalFrames: number
  fps: number
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  timingStripPreviewFrames: Record<string, number> | null
  constrainGraphFrameDelta?: (deltaFrames: number, draggedKeyframeIds: string[]) => number
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  onSelectionChange?: (keyframeIds: Set<string>) => void
  onPropertyChange?: (property: AnimatableProperty | null) => void
  onScrub?: (frame: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  onNavigateToKeyframe?: (frame: number) => void
  transitionBlockedRanges?: BlockedFrameRange[]
  proceduralPreview?: ProceduralPreviewInput
  snapEnabled: boolean
  graphHandleVisibility: 'selected' | 'all'
  graphRulerUnit: 'frames' | 'seconds'
  autoZoomGraphHeight: boolean
  graphVerticalZoomValue: number
  /** Hide the graph's own playhead line (the dopesheet draws a shared one). */
  hidePlayhead?: boolean
}

const panelStyle: CSSProperties = { height: `calc(100% - ${RULER_HEIGHT}px)` }

export function DopesheetGraphPane({
  hasRows,
  emptyStateMessage,
  showEmptyGuidance,
  proceduralHint,
  propertyColumnElements,
  propertyColumnWidth = PROPERTY_COLUMN_WIDTH,
  graphPaneRef,
  disabled,
  graphDisplayPropertyLocked,
  focusGraphPane,
  handleGraphPaneKeyDown,
  graphPaneSize,
  graphVisiblePropertiesSize,
  viewport,
  updateViewport,
  itemId,
  keyframesByProperty,
  graphDisplayProperty,
  graphVisibleProperties,
  selectedKeyframeIds,
  currentFrame,
  itemFrom,
  totalFrames,
  fps,
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
  graphHandleVisibility,
  graphRulerUnit,
  autoZoomGraphHeight,
  graphVerticalZoomValue,
  hidePlayhead,
}: DopesheetGraphPaneProps) {
  if (!hasRows) {
    return (
      <DopesheetEmptyState
        showGuidance={showEmptyGuidance}
        fallbackMessage={emptyStateMessage}
        proceduralHint={proceduralHint}
      />
    )
  }

  return (
    <div className="flex min-h-0" style={panelStyle}>
      <div className="flex-shrink-0 overflow-auto" style={{ width: propertyColumnWidth }}>
        {propertyColumnElements}
      </div>
      <div
        ref={graphPaneRef}
        data-testid="dopesheet-graph-pane"
        tabIndex={disabled || graphDisplayPropertyLocked ? undefined : -1}
        className="min-w-0 flex-1 border-l border-border/60 outline-none"
        onMouseEnter={focusGraphPane}
        onPointerDownCapture={focusGraphPane}
        onKeyDown={handleGraphPaneKeyDown}
      >
        {graphPaneSize.width > 0 && graphPaneSize.height > 0 && graphVisiblePropertiesSize > 0 ? (
          <EmbeddedValueGraphEditor
            frameViewport={viewport}
            onFrameViewportChange={updateViewport}
            itemId={itemId}
            keyframesByProperty={keyframesByProperty}
            selectedProperty={graphDisplayProperty}
            overlayProperties={graphVisibleProperties}
            selectedKeyframeIds={selectedKeyframeIds}
            currentFrame={currentFrame}
            itemFrom={itemFrom}
            totalFrames={totalFrames}
            fps={fps}
            width={graphPaneSize.width}
            height={graphPaneSize.height}
            onKeyframeMove={onKeyframeMove}
            previewFramesById={timingStripPreviewFrames}
            constrainFrameDelta={constrainGraphFrameDelta}
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
            handleVisibility={graphHandleVisibility}
            rulerUnit={graphRulerUnit}
            autoZoomGraphHeight={autoZoomGraphHeight}
            externalValueZoomLevel={graphVerticalZoomValue}
            disabled={disabled || graphDisplayPropertyLocked}
            hidePlayhead={hidePlayhead}
          />
        ) : null}
      </div>
    </div>
  )
}
