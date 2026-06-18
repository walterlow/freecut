import { cn } from '@/shared/ui/cn'

/** Top-handle style for the playhead. */
type PlayheadHandle = 'none' | 'flag'

interface PlayheadMarksProps {
  /**
   * Top handle. `flag` renders the rounded-bottom tab shared across the editor's
   * timelines; `none` renders just the vertical line (e.g. the body line of a
   * split-ruler playhead whose flag is drawn separately up in the ruler).
   */
  handle?: PlayheadHandle
  /** Downward pointer triangle just below the flag (Color navigator). */
  pointer?: boolean
  /**
   * Bleed the line 1px past the bottom edge so it covers a 1px seam border sat
   * directly beneath it (the dopesheet ruler flag → graph body seam).
   */
  bleedBottom?: boolean
  /** Extra classes merged onto the vertical line (e.g. a z-index override). */
  className?: string
  /**
   * Drop the whole group (line + flag + pointer) down by this many pixels. Used
   * by the Edit ruler so the flag sits in the tick lane below the IO bar's
   * dedicated lane, rather than overlapping it.
   */
  topOffsetPx?: number
}

/**
 * Shared visual marks for a timeline playhead: a vertical accent-orange line
 * (the `--color-timeline-playhead` token) with an optional flag handle, optional
 * pointer, and a soft glow.
 *
 * Purely presentational — the parent owns positioning (it translates this group
 * to the current frame). The marks anchor at x=0 of the parent and self-center,
 * so the parent's left edge is the exact playhead position.
 *
 * Used by the Edit timeline, dopesheet, Animate strip and Color navigator
 * playheads. The value-graph playhead is SVG and draws its own line.
 */
export function PlayheadMarks({
  handle = 'flag',
  pointer = false,
  bleedBottom = false,
  className,
  topOffsetPx = 0,
}: PlayheadMarksProps) {
  return (
    <>
      <span
        className={cn(
          'pointer-events-none absolute w-px -translate-x-1/2 bg-timeline-playhead shadow-[0_0_5px_rgba(255,140,58,0.65)]',
          bleedBottom ? '-bottom-px' : 'bottom-0',
          className,
        )}
        style={{ top: topOffsetPx }}
      />
      {handle === 'flag' && (
        <span
          className="pointer-events-none absolute left-0 h-3 w-2 -translate-x-1/2 rounded-b-[2px] border border-timeline-playhead/60 bg-timeline-playhead shadow-[0_0_7px_rgba(255,140,58,0.55)]"
          style={{ top: topOffsetPx }}
        />
      )}
      {pointer && (
        <span
          className="pointer-events-none absolute left-0 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-timeline-playhead"
          style={{ top: topOffsetPx + 12 }}
        />
      )}
    </>
  )
}
