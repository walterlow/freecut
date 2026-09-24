import type { TFunction } from 'i18next'
import { cn } from '@/shared/ui/cn'
import type { TimelineItem } from '@/types/timeline'
import type { MotionSpanDragCommands, MotionSpanTrimCommands } from './motion-span-interactions'
import { RULER_DIVISIONS, type InlineCurveState } from './motion-timeline-primitives'

interface MotionLayerSpanProps {
  item: TimelineItem
  isLayerLocked: boolean
  selected: boolean
  selectedItemIds: string[]
  hasProceduralMotion: boolean
  durationInFrames: number
  frameToMotionPercent: (frame: number) => number
  visibleFrameRange: number
  t: TFunction
  spanDrag: MotionSpanDragCommands
  spanTrim: MotionSpanTrimCommands
}

/** The draggable layer span: body text, the two trim handles and the fx badge. */
function MotionLayerSpan({
  item,
  isLayerLocked,
  selected,
  selectedItemIds,
  hasProceduralMotion,
  durationInFrames,
  frameToMotionPercent,
  visibleFrameRange,
  t,
  spanDrag,
  spanTrim,
}: MotionLayerSpanProps) {
  return (
    <button
      type="button"
      data-testid={`motion-layer-span-${item.id}`}
      data-motion-span-drag-visual
      data-from-frame={item.from}
      data-to-frame={item.from + item.durationInFrames}
      disabled={isLayerLocked}
      onPointerDown={(event) =>
        !isLayerLocked &&
        spanDrag.begin(
          event,
          selected && !(event.metaKey || event.ctrlKey || event.shiftKey)
            ? selectedItemIds
            : [item.id],
        )
      }
      onPointerMove={spanDrag.move}
      onPointerUp={spanDrag.end}
      onPointerCancel={spanDrag.cancel}
      onClick={(event) => {
        event.stopPropagation()
      }}
      className={cn(
        '@container absolute top-1/2 h-5 -translate-y-1/2 touch-none overflow-hidden rounded-sm border px-1 text-left text-[9px] shadow-sm transition-colors',
        isLayerLocked ? 'cursor-not-allowed opacity-55' : 'cursor-grab active:cursor-grabbing',
        selected
          ? 'border-foreground/80 bg-timeline-motion-segment/90 text-foreground'
          : 'border-timeline-motion-segment/80 bg-timeline-motion-segment/70 text-foreground hover:bg-timeline-motion-segment/85',
      )}
      style={{
        left: `${frameToMotionPercent(item.from)}%`,
        width: `${Math.max(0.6, (item.durationInFrames / visibleFrameRange) * 100)}%`,
      }}
      title={`${item.from}–${item.from + item.durationInFrames - 1}`}
    >
      {!isLayerLocked ? (
        <>
          <span
            role="slider"
            aria-label={`Trim ${item.label || item.type} start`}
            aria-valuemin={0}
            aria-valuemax={item.from + item.durationInFrames - 1}
            aria-valuenow={item.from}
            tabIndex={-1}
            data-testid={`motion-trim-start-${item.id}`}
            onPointerDown={(event) => spanTrim.begin(event, item, 'start')}
            onPointerMove={spanTrim.move}
            onPointerUp={spanTrim.end}
            onPointerCancel={spanTrim.cancel}
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none bg-foreground/10 opacity-70 hover:bg-foreground/25 hover:opacity-100"
          />
          <span
            role="slider"
            aria-label={`Trim ${item.label || item.type} end`}
            aria-valuemin={item.from + 1}
            aria-valuemax={durationInFrames}
            aria-valuenow={item.from + item.durationInFrames}
            tabIndex={-1}
            data-testid={`motion-trim-end-${item.id}`}
            onPointerDown={(event) => spanTrim.begin(event, item, 'end')}
            onPointerMove={spanTrim.move}
            onPointerUp={spanTrim.end}
            onPointerCancel={spanTrim.cancel}
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none bg-foreground/10 opacity-70 hover:bg-foreground/25 hover:opacity-100"
          />
        </>
      ) : null}
      <span className="pointer-events-none block truncate px-1.5">{item.label || item.type}</span>
      {hasProceduralMotion ? (
        <span
          data-testid={`motion-procedural-badge-${item.id}`}
          className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border border-sky-300/45 bg-sky-950/75 px-1 font-mono text-[8px] font-semibold text-sky-200 @min-[44px]:block"
          title={t('timeline.clipIndicators.hasMotion')}
        >
          ƒx
        </span>
      ) : null}
    </button>
  )
}

export interface MotionLayerLaneProps {
  item: TimelineItem
  isLayerLocked: boolean
  selected: boolean
  selectedItemIds: string[]
  activeInlineCurve: InlineCurveState | null
  hasProceduralMotion: boolean
  durationInFrames: number
  frameToMotionPercent: (frame: number) => number
  visibleFrameRange: number
  t: TFunction
  spanDrag: MotionSpanDragCommands
  spanTrim: MotionSpanTrimCommands
  beginPlayheadScrub: (event: React.PointerEvent<HTMLDivElement>) => void
  movePlayheadScrub: (event: React.PointerEvent<HTMLDivElement>) => void
  endPlayheadScrub: (event: React.PointerEvent<HTMLDivElement>) => void
}

/**
 * One row's slice of the motion timeline: the scrub surface, the static
 * divisions and — while no inline curve pane is open — the layer span.
 */
export function MotionLayerLane({
  item,
  isLayerLocked,
  selected,
  selectedItemIds,
  activeInlineCurve,
  hasProceduralMotion,
  durationInFrames,
  frameToMotionPercent,
  visibleFrameRange,
  t,
  spanDrag,
  spanTrim,
  beginPlayheadScrub,
  movePlayheadScrub,
  endPlayheadScrub,
}: MotionLayerLaneProps) {
  return (
    <div className="relative min-w-0 flex-1 cursor-default overflow-hidden">
      <div
        data-motion-timeline-lane
        data-motion-viewport-surface
        className="absolute inset-0 overflow-hidden"
        onPointerDown={beginPlayheadScrub}
        onPointerMove={movePlayheadScrub}
        onPointerUp={endPlayheadScrub}
        onPointerCancel={endPlayheadScrub}
      >
        {Array.from({ length: RULER_DIVISIONS + 1 }, (_, tick) => (
          <div
            key={tick}
            data-motion-static-x
            className="pointer-events-none absolute inset-y-0 border-l border-border/45"
            style={{ left: `${(tick / RULER_DIVISIONS) * 100}%` }}
          />
        ))}
        {!activeInlineCurve ? (
          <MotionLayerSpan
            item={item}
            isLayerLocked={isLayerLocked}
            selected={selected}
            selectedItemIds={selectedItemIds}
            hasProceduralMotion={hasProceduralMotion}
            durationInFrames={durationInFrames}
            frameToMotionPercent={frameToMotionPercent}
            visibleFrameRange={visibleFrameRange}
            t={t}
            spanDrag={spanDrag}
            spanTrim={spanTrim}
          />
        ) : null}
      </div>
    </div>
  )
}
