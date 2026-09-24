import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { TextMotionTimelineLanes } from './motion-timeline-lanes'
import { MotionDopesheetLanes } from './motion-dopesheet-content'
import { LAYER_COLUMN_WIDTH, type InlineCurveState } from './motion-timeline-primitives'
import type { MotionTimeViewport } from './motion-time-viewport-controller'
import type { AnimatableProperty, DirectLinkableProperty, ItemKeyframes } from '@/types/keyframe'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { TimelineItem } from '@/types/timeline'

interface PathVertexToolbarProps {
  itemId: string
  showAllPathVertices: boolean
  maskEditingItemId: string | null
  selectedPathVertexIndices: readonly number[]
  setAllPathVertexItemIds: Dispatch<SetStateAction<Set<string>>>
}

function getPathVertexSummary(
  itemId: string,
  showAllPathVertices: boolean,
  maskEditingItemId: string | null,
  selectedPathVertexIndices: readonly number[],
): string {
  if (showAllPathVertices) return 'All path vertices'
  if (maskEditingItemId !== itemId || selectedPathVertexIndices.length === 0) return 'Vertex 1'
  const count = selectedPathVertexIndices.length
  return `${count} selected ${count === 1 ? 'vertex' : 'vertices'}`
}

/** A path shape's visible-vertex switch and the hint that explains it. */
function PathVertexToolbar({
  itemId,
  showAllPathVertices,
  maskEditingItemId,
  selectedPathVertexIndices,
  setAllPathVertexItemIds,
}: PathVertexToolbarProps) {
  return (
    <div
      className="flex h-7 border-b border-border/70 bg-background/45"
      data-testid={`motion-path-vertex-toolbar-${itemId}`}
    >
      <div
        className="flex items-center justify-between gap-2 border-r border-border px-2 text-[10px] text-muted-foreground"
        style={{ width: LAYER_COLUMN_WIDTH }}
      >
        <span>
          {getPathVertexSummary(
            itemId,
            showAllPathVertices,
            maskEditingItemId,
            selectedPathVertexIndices,
          )}
        </span>
        <button
          type="button"
          className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
          data-testid={`motion-toggle-all-path-vertices-${itemId}`}
          aria-pressed={showAllPathVertices}
          onClick={() =>
            setAllPathVertexItemIds((current) => {
              const next = new Set(current)
              if (next.has(itemId)) next.delete(itemId)
              else next.add(itemId)
              return next
            })
          }
        >
          {showAllPathVertices ? 'Selected vertices' : 'All vertices'}
        </button>
      </div>
      <div className="flex flex-1 items-center px-2 text-[10px] text-muted-foreground/70">
        Select path points in the preview to focus these channels.
      </div>
    </div>
  )
}

export interface MotionLayerPropertyRowsProps {
  item: TimelineItem
  expanded: boolean
  isLayerLocked: boolean
  isPathShape: boolean
  showAllPathVertices: boolean
  maskEditingItemId: string | null
  selectedPathVertexIndices: readonly number[]
  setAllPathVertexItemIds: Dispatch<SetStateAction<Set<string>>>
  textMotionBands: TextMotionTimelineBand[]
  timeViewport: MotionTimeViewport
  itemById: Record<string, TimelineItem>
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  durationInFrames: number
  fps: number
  canvas: { width: number; height: number }
  propertyFilter: 'all' | 'keyframed'
  activeInlineCurve: InlineCurveState | null
  activeCompositionId: string
  selectItems: (itemIds: string[]) => void
  setInlineCurve: Dispatch<SetStateAction<InlineCurveState | null>>
  pause: () => void
  setScrubFrame: (frame: number) => void
  updateTimeViewport: (viewport: MotionTimeViewport) => void
  beginPropertyLinkDrag: (
    event: React.PointerEvent<HTMLButtonElement>,
    itemId: string,
    property: DirectLinkableProperty,
  ) => void
  handleRemovePropertyLink: (itemId: string, property: DirectLinkableProperty) => void
  handleSetPropertyExpression: (
    itemId: string,
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  handleRemovePropertyExpression: (itemId: string, property: DirectLinkableProperty) => void
}

/**
 * Everything a layer row expands into: the path-vertex switch, the text-motion
 * lanes and the dope-sheet property rows. Renders nothing while collapsed.
 */
export function MotionLayerPropertyRows({
  item,
  expanded,
  isLayerLocked,
  isPathShape,
  showAllPathVertices,
  maskEditingItemId,
  selectedPathVertexIndices,
  setAllPathVertexItemIds,
  textMotionBands,
  timeViewport,
  itemById,
  itemKeyframes,
  properties,
  durationInFrames,
  fps,
  canvas,
  propertyFilter,
  activeInlineCurve,
  activeCompositionId,
  selectItems,
  setInlineCurve,
  pause,
  setScrubFrame,
  updateTimeViewport,
  beginPropertyLinkDrag,
  handleRemovePropertyLink,
  handleSetPropertyExpression,
  handleRemovePropertyExpression,
}: MotionLayerPropertyRowsProps): ReactNode {
  if (!expanded) return null
  return (
    <div inert={isLayerLocked ? true : undefined} aria-disabled={isLayerLocked}>
      {isPathShape ? (
        <PathVertexToolbar
          itemId={item.id}
          showAllPathVertices={showAllPathVertices}
          maskEditingItemId={maskEditingItemId}
          selectedPathVertexIndices={selectedPathVertexIndices}
          setAllPathVertexItemIds={setAllPathVertexItemIds}
        />
      ) : null}
      {textMotionBands.length > 0 ? (
        <TextMotionTimelineLanes
          itemId={item.id}
          bands={textMotionBands}
          timeViewport={timeViewport}
        />
      ) : null}
      <MotionDopesheetLanes
        item={item}
        itemById={itemById}
        itemKeyframes={itemKeyframes}
        properties={properties}
        compositionDurationInFrames={durationInFrames}
        fps={fps}
        canvas={canvas}
        propertyFilter={propertyFilter}
        timeViewport={timeViewport}
        inlineCurveProperty={
          activeInlineCurve?.itemId === item.id ? activeInlineCurve.property : null
        }
        disabled={isLayerLocked}
        onSelectItem={(itemId) => selectItems([itemId])}
        onInlineCurveChange={(property) => {
          setInlineCurve(
            property
              ? {
                  compositionId: activeCompositionId,
                  itemId: item.id,
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
  )
}
