import { useTranslation } from 'react-i18next'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { RULER_HEIGHT } from './dopesheet-constants'
import { formatRulerSeconds } from './dopesheet-live-ruler-layout'

interface DopesheetRulerHeaderProps {
  propertyGridStyle: CSSProperties
  timelineRef: React.RefObject<HTMLDivElement | null>
  onRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** Tick marks the standalone axis draws; the linked-axis canvas replaces them. */
  ticks: number[]
  frameToX: (frame: number) => number
  fps: number
  rulerUnit: 'frames' | 'seconds'
  rulerLabelFrameOffset: number
  liveRulerCanvas?: ReactNode
  reservedRightGutterWidth?: number
  propertyFilter?: 'all' | 'keyframed'
  onPropertyFilterChange?: (filter: 'all' | 'keyframed') => void
}

export function DopesheetRulerHeader({
  propertyGridStyle,
  timelineRef,
  onRulerPointerDown,
  onRulerPointerMove,
  onRulerPointerUp,
  onRulerPointerLeave,
  ticks,
  frameToX,
  fps,
  rulerUnit,
  rulerLabelFrameOffset,
  liveRulerCanvas,
  reservedRightGutterWidth = 0,
  propertyFilter = 'all',
  onPropertyFilterChange,
}: DopesheetRulerHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
      <div
        className="flex items-center justify-between gap-2 px-1 text-[10px] font-medium text-muted-foreground"
        style={{ height: RULER_HEIGHT }}
      >
        <span>{t('timeline.keyframeEditor.property')}</span>
        {onPropertyFilterChange ? (
          <div
            role="group"
            aria-label={t('timeline.keyframeEditor.propertyVisibility')}
            className="flex h-[18px] shrink-0 items-center rounded border border-border/70 bg-background/70 p-px"
          >
            {(['keyframed', 'all'] as const).map((filter) => {
              const selected = propertyFilter === filter
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={selected}
                  className={`h-4 rounded px-1.5 text-[9px] leading-none transition-colors ${
                    selected
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => onPropertyFilterChange(filter)}
                >
                  {t(
                    filter === 'keyframed'
                      ? 'timeline.keyframeEditor.animatedProperties'
                      : 'timeline.keyframeEditor.allProperties',
                  )}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div
        data-testid="dopesheet-ruler"
        ref={timelineRef}
        className="relative border-l border-border cursor-ew-resize overflow-x-clip"
        style={{ height: RULER_HEIGHT }}
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
        onPointerUp={onRulerPointerUp}
        onPointerCancel={onRulerPointerUp}
        onPointerLeave={onRulerPointerLeave}
      >
        {liveRulerCanvas ?? (
          <div data-motion-viewport-surface data-motion-ruler-surface className="absolute inset-0">
            <DopesheetRulerTicks
              ticks={ticks}
              frameToX={frameToX}
              fps={fps}
              rulerUnit={rulerUnit}
              rulerLabelFrameOffset={rulerLabelFrameOffset}
            />
          </div>
        )}
        {reservedRightGutterWidth > 0 ? (
          <div
            data-testid="dopesheet-ruler-scrollbar-gutter"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 border-l border-border/60 bg-background/80"
            style={{ width: reservedRightGutterWidth }}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Ruler tick labels. Standalone axes show item-local frames; a linked main
 * timeline axis shows the timeline's own frame numbers.
 */
function formatRulerTick(
  frame: number,
  rulerLabelFrameOffset: number,
  rulerUnit: 'frames' | 'seconds',
  fps: number,
): string {
  const displayFrame = frame + rulerLabelFrameOffset
  if (rulerUnit === 'frames' || !fps || fps <= 0) {
    return String(displayFrame)
  }
  return formatRulerSeconds(displayFrame / fps)
}

/**
 * Major ticks with a pooled minor-tick background between them. The layer spans
 * from the first to the last tick plus one major spacing so the pooled gradient
 * lands on the same pixels as the marks it sits under.
 */
function DopesheetRulerTicks({
  ticks,
  frameToX,
  fps,
  rulerUnit,
  rulerLabelFrameOffset,
}: {
  ticks: number[]
  frameToX: (frame: number) => number
  fps: number
  rulerUnit: 'frames' | 'seconds'
  rulerLabelFrameOffset: number
}) {
  const firstTick = ticks[0]
  const lastTick = ticks[ticks.length - 1]
  const secondTick = ticks[1]
  const hasMinorTicks = firstTick !== undefined && lastTick !== undefined && ticks.length > 1
  const firstX = firstTick === undefined ? 0 : frameToX(firstTick)
  const majorSpacing =
    hasMinorTicks && secondTick !== undefined ? Math.abs(frameToX(secondTick) - firstX) : 0
  const minorSpacing = majorSpacing / 4

  return (
    <>
      {hasMinorTicks && firstTick !== undefined && lastTick !== undefined ? (
        <div
          data-dopesheet-ruler-minor-ticks
          className="pointer-events-none absolute bottom-0 h-1"
          style={{
            left: Math.round(firstX),
            width: Math.ceil(frameToX(lastTick) - firstX + majorSpacing),
            backgroundImage:
              'linear-gradient(to right, rgba(255, 255, 255, 0.14) 1px, transparent 1px)',
            backgroundSize: `${minorSpacing}px 100%`,
          }}
        />
      ) : null}
      {ticks.map((frame) => (
        <div
          key={frame}
          data-dopesheet-ruler-major-tick
          className="pointer-events-none absolute bottom-0 h-2 border-l border-white/30"
          style={{ left: Math.round(frameToX(frame)) }}
        >
          <span className="absolute bottom-[7px] left-1 whitespace-nowrap text-[10px] text-muted-foreground">
            {formatRulerTick(frame, rulerLabelFrameOffset, rulerUnit, fps)}
          </span>
        </div>
      ))}
    </>
  )
}
