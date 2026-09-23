import type { ReactNode, RefObject } from 'react'
import { DopesheetPlayheadOverlay } from './dopesheet-playhead-overlays'

/** Geometry the three dopesheet playhead overlays share. */
export interface DopesheetPlayheadElementsProps {
  /** Off when the parent owns one shared overlay, so nothing is built below. */
  showPlayhead: boolean
  /** Skim mode: the sheet follows the preview scrubber instead of owning a scrub. */
  skim: boolean
  left: number
  /** Item-local playhead frame. The skim visual follows the global playhead. */
  playheadFrame?: number
  currentFrame: number
  itemFrom: number
  totalFrames: number
  clampToItemBounds: boolean
  localScrubActiveRef: RefObject<boolean>
  localScrubHandoffFrameRef: RefObject<number | null>
  frameToX: (frame: number) => number
  globalFrameToX?: (globalFrame: number) => number
  positionSyncTargetRef?: RefObject<HTMLDivElement | null>
  maxLeft: number
  fps: number
  isRulerScrubbing: boolean
}

/** The `sheet` pane overlay, the `split` view's spanning overlay, and the skimmer. */
export interface DopesheetPlayheadElements {
  sheet: ReactNode
  split: ReactNode
  skim: ReactNode
}

/**
 * Builds the three playhead overlays from one geometry bundle. The exclusive
 * (`dopesheet`/`graph`) and `split` shells place them differently, so they come
 * back as elements rather than a single component.
 */
export function buildDopesheetPlayheadElements({
  showPlayhead,
  skim,
  playheadFrame,
  ...overlay
}: DopesheetPlayheadElementsProps): DopesheetPlayheadElements {
  const shared = { ...overlay, followPreviewFrame: !skim }
  return {
    sheet: showPlayhead ? (
      <DopesheetPlayheadOverlay variant="sheet" playheadFrame={playheadFrame} {...shared} />
    ) : null,
    split: showPlayhead ? (
      <DopesheetPlayheadOverlay variant="split" playheadFrame={playheadFrame} {...shared} />
    ) : null,
    skim: skim ? <DopesheetPlayheadOverlay variant="skim" {...shared} /> : null,
  }
}
