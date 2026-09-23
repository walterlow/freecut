/**
 * Dopesheet presentation shells.
 * The editor derives the sheet, graph, ruler and playhead state; these shells
 * only place it. Lanes, classic Edit and the default workspace lay the same
 * panes out differently, so each mode owns its tree instead of one function
 * returning three shapes.
 */

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { TFunction } from 'i18next'
import { Scissors } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import { DopesheetHeaderFrameInputs } from './dopesheet-header-frame-inputs'
import { RULER_HEIGHT } from './dopesheet-constants'
import type { UseDopesheetNavigationReturn } from './use-dopesheet-navigation'
import type { PropertyExpressionEditorApi } from './use-property-expression-editor'

/** Header frame inputs the workspace toolbar and the classic shell share. */
export type DopesheetHeaderFrameInputsProps = React.ComponentProps<
  typeof DopesheetHeaderFrameInputs
>

/** The panes every shell places, built once by the editor. */
export interface DopesheetPaneElements {
  rulerHeaderElement: ReactNode
  sheetBodyElement: ReactNode
  graphPaneElement: ReactNode
  playheadOverlayElement: ReactNode
  splitPlayheadOverlayElement: ReactNode
  skimPlayheadOverlayElement: ReactNode
  expressionDockElement: ReactNode
  expressionReferenceDrag: PropertyExpressionEditorApi['expressionReferenceDrag']
}

interface DopesheetShellRootProps {
  pickWhipRootRef: RefObject<HTMLDivElement | null>
  className?: string
  height: number
  disabled: boolean
  handleWheel: UseDopesheetNavigationReturn['handleWheel']
}

export interface DopesheetLanesPresentationProps
  extends DopesheetShellRootProps,
    Pick<
      DopesheetPaneElements,
      | 'graphPaneElement'
      | 'sheetBodyElement'
      | 'skimPlayheadOverlayElement'
      | 'playheadOverlayElement'
      | 'expressionDockElement'
      | 'expressionReferenceDrag'
    > {
  timelineRef: RefObject<HTMLDivElement | null>
  timelineGridDivisions?: number
  timelineCellBorderWidth: number
  columnWidth: number
  showSheetPane: boolean
  showGraphPane: boolean
  handleGraphPaneKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/**
 * Lane layout: the sheet fills the editor and shares the main timeline's grid,
 * with the graph pane replacing it when that mode is asked for.
 */
export function DopesheetLanesPresentation({
  pickWhipRootRef,
  className,
  height,
  disabled,
  handleWheel,
  handleGraphPaneKeyDown,
  timelineRef,
  timelineGridDivisions,
  timelineCellBorderWidth,
  columnWidth,
  showSheetPane,
  showGraphPane,
  graphPaneElement,
  sheetBodyElement,
  skimPlayheadOverlayElement,
  playheadOverlayElement,
  expressionDockElement,
  expressionReferenceDrag,
}: DopesheetLanesPresentationProps) {
  return (
    <div
      ref={pickWhipRootRef}
      data-testid="dopesheet-editor-root"
      data-motion-shared-grid-divisions={timelineGridDivisions}
      data-motion-shared-grid-border-width={
        timelineGridDivisions ? timelineCellBorderWidth : undefined
      }
      className={cn(
        'relative flex flex-col overflow-hidden',
        disabled && 'opacity-60 pointer-events-none',
        className,
      )}
      style={{ height, width: '100%' }}
      onKeyDown={handleGraphPaneKeyDown}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden" onWheel={handleWheel}>
        <div
          ref={timelineRef}
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ left: columnWidth }}
        />
        {showGraphPane ? graphPaneElement : sheetBodyElement}
        {showSheetPane ? skimPlayheadOverlayElement : null}
        {showSheetPane ? playheadOverlayElement : null}
      </div>
      {expressionDockElement}
      {expressionReferenceDrag ? (
        <PickWhipOverlay
          presentation={expressionReferenceDrag.presentation}
          testId="expression-reference-pick-whip"
        />
      ) : null}
    </div>
  )

}

export interface DopesheetClassicPresentationProps
  extends DopesheetShellRootProps,
    Pick<
      DopesheetPaneElements,
      | 'rulerHeaderElement'
      | 'sheetBodyElement'
      | 'skimPlayheadOverlayElement'
      | 'playheadOverlayElement'
    > {
  width: number
  t: TFunction
  keyframeCount: number
  trimmedKeyframeCount: number
  onTrimAnimation?: () => void
  headerFrameInputs: DopesheetHeaderFrameInputsProps
  viewportInteractionEnabled: boolean
  affectedFrameRangeOverlayElement: ReactNode
  effectiveTimelineWidth: number
  columnWidth: number
}

/**
 * Classic Edit layout: a compact header with the frame inputs, a bordered sheet
 * taking the rest of the panel, and its own scrolling viewport.
 */
export function DopesheetClassicPresentation({
  pickWhipRootRef,
  className,
  height,
  width,
  disabled,
  t,
  keyframeCount,
  trimmedKeyframeCount,
  onTrimAnimation,
  headerFrameInputs,
  viewportInteractionEnabled,
  handleWheel,
  affectedFrameRangeOverlayElement,
  effectiveTimelineWidth,
  columnWidth,
  skimPlayheadOverlayElement,
  playheadOverlayElement,
  rulerHeaderElement,
  sheetBodyElement,
}: DopesheetClassicPresentationProps) {
  return (
    <div
      ref={pickWhipRootRef}
      data-testid="dopesheet-editor-root"
      className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
      style={{ height, width }}
    >
      <div className="flex min-h-7 flex-shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {t('timeline.keyframeEditor.keyframes', {
              count: keyframeCount,
            })}
          </span>
          {trimmedKeyframeCount > 0 && onTrimAnimation ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px] text-amber-300 hover:text-amber-200"
              onClick={onTrimAnimation}
              title={t('timeline.keyframeEditor.trimAnimationHint', {
                count: trimmedKeyframeCount,
              })}
            >
              <Scissors className="h-3 w-3" />
              {t('timeline.keyframeEditor.trimmedKeyframes', {
                count: trimmedKeyframeCount,
              })}
            </Button>
          ) : null}
          <DopesheetHeaderFrameInputs {...headerFrameInputs} />
        </div>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden border border-border',
          disabled && 'pointer-events-none opacity-60',
        )}
        onWheel={viewportInteractionEnabled ? handleWheel : undefined}
      >
        {affectedFrameRangeOverlayElement ? (
          <div
            data-motion-viewport-surface
            data-motion-viewport-axis-width={effectiveTimelineWidth}
            className="pointer-events-none absolute bottom-0 right-0 z-[5] overflow-hidden"
            style={{ left: columnWidth, top: RULER_HEIGHT }}
          >
            {affectedFrameRangeOverlayElement}
          </div>
        ) : null}
        {skimPlayheadOverlayElement}
        {playheadOverlayElement}
        {rulerHeaderElement}
        {sheetBodyElement}
      </div>
    </div>
  )

}

export interface DopesheetEditorPresentationProps
  extends DopesheetPaneElements,
    DopesheetShellRootProps {
  width: number
  t: TFunction
  visualizationMode: 'dopesheet' | 'graph' | 'split'
  isSplitView: boolean
  showSheetPane: boolean
  showGraphPane: boolean
  propertyGridStyle: CSSProperties
  toolbarElement: ReactNode
  timingStripElement: ReactNode
  navigatorElement: ReactNode
}

/**
 * Default workspace layout: toolbar, then the sheet / graph / split body with one
 * shared playhead, then the timing strip and the navigator. The toolbar, timing
 * strip and navigator are built by the editor so the shells only place them.
 */
export function DopesheetEditorPresentation({
  pickWhipRootRef,
  className,
  height,
  width,
  disabled,
  t,
  visualizationMode,
  isSplitView,
  showSheetPane,
  showGraphPane,
  handleWheel,
  toolbarElement,
  rulerHeaderElement,
  sheetBodyElement,
  graphPaneElement,
  playheadOverlayElement,
  splitPlayheadOverlayElement,
  skimPlayheadOverlayElement,
  expressionDockElement,
  expressionReferenceDrag,
  timingStripElement,
  navigatorElement,
}: DopesheetEditorPresentationProps) {
  return (
    <div
      ref={pickWhipRootRef}
      data-testid="dopesheet-editor-root"
      className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
      style={{ height, width }}
    >
      {toolbarElement}

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
              role="region"
              aria-label={t('timeline.keyframeEditor.sheet')}
              onWheel={handleWheel}
            >
              {sheetBodyElement}
            </div>
            <div
              className="min-h-0 flex-1 overflow-hidden border-t border-border/60"
              role="region"
              aria-label={t('timeline.keyframeEditor.graph')}
            >
              {graphPaneElement}
            </div>
            {skimPlayheadOverlayElement}
            {splitPlayheadOverlayElement}
          </>
        ) : (
          <>
            {/* Sheet mode only: the graph renders its own aligned playhead
                (GraphPlayhead) using the graph's coordinate space. */}
            {showSheetPane && skimPlayheadOverlayElement}
            {showSheetPane && playheadOverlayElement}
            {rulerHeaderElement}
            {showGraphPane ? graphPaneElement : sheetBodyElement}
          </>
        )}
      </div>
      {expressionDockElement}
      {timingStripElement}
      {navigatorElement}
      {expressionReferenceDrag ? (
        <PickWhipOverlay
          presentation={expressionReferenceDrag.presentation}
          testId="expression-reference-pick-whip"
        />
      ) : null}
    </div>
  )
}
