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
import { EmbeddedValueGraphEditor } from '../value-graph-editor'
import { PROPERTY_COLUMN_WIDTH, RULER_HEIGHT } from './dopesheet-constants'
import type { Viewport } from './dopesheet-types'

interface DopesheetGraphPaneProps {
  hasRows: boolean
  emptyStateMessage: string
  propertyColumnElements: ReactNode
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
  totalFrames: number
  fps: number
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  timingStripPreviewFrames: Record<string, number> | null
  constrainGraphFrameDelta?: (deltaFrames: number, draggedKeyframeIds: string[]) => number
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  onSelectionChange?: (keyframeIds: Set<string>) => void
  onPropertyChange?: (property: AnimatableProperty | null) => void
  onScrub?: (frame: number) => void
  onScrubEnd?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  onNavigateToKeyframe?: (frame: number) => void
  transitionBlockedRanges?: BlockedFrameRange[]
  snapEnabled: boolean
  showAllGraphHandles: boolean
  graphRulerUnit: 'frames' | 'seconds'
  autoZoomGraphHeight: boolean
  graphVerticalZoomValue: number
}

const panelStyle: CSSProperties = { height: `calc(100% - ${RULER_HEIGHT}px)` }
const propertyColumnStyle: CSSProperties = { width: PROPERTY_COLUMN_WIDTH }

export function DopesheetGraphPane({
  hasRows,
  emptyStateMessage,
  propertyColumnElements,
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
  totalFrames,
  fps,
  onKeyframeMove,
  timingStripPreviewFrames,
  constrainGraphFrameDelta,
  onBezierHandleMove,
  onSelectionChange,
  onPropertyChange,
  onScrub,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onAddKeyframe,
  onRemoveKeyframes,
  onNavigateToKeyframe,
  transitionBlockedRanges,
  snapEnabled,
  showAllGraphHandles,
  graphRulerUnit,
  autoZoomGraphHeight,
  graphVerticalZoomValue,
}: DopesheetGraphPaneProps) {
  if (!hasRows) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {emptyStateMessage}
      </div>
    )
  }

  return (
    <div className="flex min-h-0" style={panelStyle}>
      <div className="flex-shrink-0 overflow-auto" style={propertyColumnStyle}>
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
            onScrubEnd={onScrubEnd}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onAddKeyframe={onAddKeyframe}
            onRemoveKeyframes={onRemoveKeyframes}
            onNavigateToKeyframe={onNavigateToKeyframe}
            transitionBlockedRanges={transitionBlockedRanges}
            snapEnabled={snapEnabled}
            showAllHandles={showAllGraphHandles}
            rulerUnit={graphRulerUnit}
            autoZoomGraphHeight={autoZoomGraphHeight}
            externalValueZoomLevel={graphVerticalZoomValue}
            disabled={disabled || graphDisplayPropertyLocked}
          />
        ) : null}
      </div>
    </div>
  )
}
