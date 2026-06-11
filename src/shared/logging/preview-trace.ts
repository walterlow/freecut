/**
 * Preview render/overlay trace (DEV-only diagnostics).
 *
 * Captures, per playback frame, which overlay path the preview pump chose and
 * which transition participants the renderer actually composited. Built to make
 * "the live preview looks wrong but export is fine" bugs trivial to diagnose
 * without hand-pasting probes — drive it via `window.__DEBUG__.captureTransition()`.
 *
 * Zero overhead when not recording (the record fns early-return on a boolean),
 * and every call site is wrapped in `import.meta.env.DEV` so the whole thing is
 * tree-shaken out of production builds. The browser-automation environment is
 * far too slow to profile the real-time pump, so this is designed to be run on
 * a real machine and dumped/analyzed in one call.
 */

/** One overlay decision the pump made for a priority playback frame. */
export interface PreviewPumpTraceEvent {
  ch: 'pump'
  /** Timeline frame the pump rendered. */
  f: number
  /** Which overlay path was shown for this frame. */
  act: 'transition-overlay' | 'fast-scrub' | 'hide' | 'fallback-hide'
  /** Whether the playback transition overlay was eligible this frame. */
  shouldShow: boolean
  /** Whether a transition window is active at this frame. */
  hasActive: boolean
  /** Whether the overlay is being held during the post-window cooldown. */
  hold: boolean
  /** `forceFastScrubOverlay` — true keeps the smooth per-frame overlay on. */
  forceFast: boolean
  /** Whether the pump fell back to the DOM Player. */
  fallback: boolean
}

/** One transition-participant draw the renderer performed. */
export interface PreviewRenderTraceEvent {
  ch: 'render'
  /** Timeline frame being rendered. */
  f: number
  /** Participant clip id (first 8 chars). */
  id: string
  /** Whether the clip is reversed (pre-conform). */
  rev: boolean
  /** Requested source time (seconds, rounded). */
  src: number
  /** Whether a DOM video element served this frame (zero-copy). */
  hasDom: boolean
  /** Whether mediabunny decode was available for this item. */
  useMb: boolean
}

export type PreviewTraceEvent = PreviewPumpTraceEvent | PreviewRenderTraceEvent

const MAX_EVENTS = 20000

let enabled = false
let events: PreviewTraceEvent[] = []

export function isPreviewTraceEnabled(): boolean {
  return enabled
}

export function startPreviewTrace(): void {
  events = []
  enabled = true
}

export function stopPreviewTrace(): void {
  enabled = false
}

export function clearPreviewTrace(): void {
  events = []
}

export function getPreviewTraceEvents(): readonly PreviewTraceEvent[] {
  return events
}

export function recordPumpTrace(event: Omit<PreviewPumpTraceEvent, 'ch'>): void {
  if (!enabled || events.length >= MAX_EVENTS) return
  events.push({ ch: 'pump', ...event })
}

export function recordRenderTrace(event: Omit<PreviewRenderTraceEvent, 'ch'>): void {
  if (!enabled || events.length >= MAX_EVENTS) return
  events.push({ ch: 'render', ...event })
}

export interface PreviewTraceWindow {
  startFrame: number
  cutPoint: number
  endFrame: number
  /** Optional ids so the analysis can label outgoing/incoming participants. */
  leftClipId?: string
  rightClipId?: string
}

export interface PreviewTraceHalfStats {
  /** Frames in this half that the pump rendered an overlay for. */
  pumpFrames: number
  /** Frames in this half that composited the transition (render events). */
  compositedFrames: number
  /** Window frames in this half the pump never rendered (visible as stalls). */
  gapFrames: number
  /** Overlay action counts in this half. */
  acts: Record<string, number>
}

export interface PreviewTraceAnalysis {
  window: PreviewTraceWindow
  windowFrames: number
  firstHalf: PreviewTraceHalfStats
  secondHalf: PreviewTraceHalfStats
  /** Contiguous ranges of window frames with no pump render (stalls). */
  gapRanges: Array<{ from: number; to: number }>
  /** True if `forceFast` changed value within the window (a mid-wipe path switch). */
  forceFastFlipped: boolean
  /** Plain-language read of what the trace shows. */
  verdict: string
}

function compressRanges(frames: number[]): Array<{ from: number; to: number }> {
  const sorted = [...new Set(frames)].sort((a, b) => a - b)
  const ranges: Array<{ from: number; to: number }> = []
  for (const f of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && f === last.to + 1) {
      last.to = f
    } else {
      ranges.push({ from: f, to: f })
    }
  }
  return ranges
}

function summarizeHalf(
  pump: PreviewPumpTraceEvent[],
  render: PreviewRenderTraceEvent[],
  from: number,
  to: number,
): PreviewTraceHalfStats {
  const inHalf = (f: number) => f >= from && f < to
  const pumpFrameSet = new Set<number>()
  const acts: Record<string, number> = {}
  for (const e of pump) {
    if (!inHalf(e.f)) continue
    pumpFrameSet.add(e.f)
    acts[e.act] = (acts[e.act] ?? 0) + 1
  }
  const compositedFrameSet = new Set<number>()
  for (const e of render) {
    if (inHalf(e.f)) compositedFrameSet.add(e.f)
  }
  let gapFrames = 0
  for (let f = from; f < to; f++) {
    if (!pumpFrameSet.has(f)) gapFrames++
  }
  return {
    pumpFrames: pumpFrameSet.size,
    compositedFrames: compositedFrameSet.size,
    gapFrames,
    acts,
  }
}

/**
 * Reduce raw trace events to a per-half summary that surfaces the common
 * preview-transition failure modes: the overlay dropping to the buffered/Player
 * path mid-wipe, frame gaps (stalls), and one half compositing far fewer frames
 * than the other.
 */
export function analyzePreviewTrace(
  events: readonly PreviewTraceEvent[],
  window: PreviewTraceWindow,
): PreviewTraceAnalysis {
  const pump = events.filter((e): e is PreviewPumpTraceEvent => e.ch === 'pump')
  const render = events.filter((e): e is PreviewRenderTraceEvent => e.ch === 'render')

  const firstHalf = summarizeHalf(pump, render, window.startFrame, window.cutPoint)
  const secondHalf = summarizeHalf(pump, render, window.cutPoint, window.endFrame)

  const pumpFrameSet = new Set(
    pump.filter((e) => e.f >= window.startFrame && e.f < window.endFrame).map((e) => e.f),
  )
  const gapFrames: number[] = []
  for (let f = window.startFrame; f < window.endFrame; f++) {
    if (!pumpFrameSet.has(f)) gapFrames.push(f)
  }
  const gapRanges = compressRanges(gapFrames)

  const forceFastValues = new Set(
    pump.filter((e) => e.f >= window.startFrame && e.f < window.endFrame).map((e) => e.forceFast),
  )
  const forceFastFlipped = forceFastValues.size > 1

  const verdict = buildVerdict(window, firstHalf, secondHalf, gapRanges, forceFastFlipped)

  return {
    window,
    windowFrames: window.endFrame - window.startFrame,
    firstHalf,
    secondHalf,
    gapRanges,
    forceFastFlipped,
    verdict,
  }
}

function buildVerdict(
  window: PreviewTraceWindow,
  firstHalf: PreviewTraceHalfStats,
  secondHalf: PreviewTraceHalfStats,
  gapRanges: Array<{ from: number; to: number }>,
  forceFastFlipped: boolean,
): string {
  const secondHalfFrames = window.endFrame - window.cutPoint
  const biggestGap = gapRanges.reduce((m, r) => Math.max(m, r.to - r.from + 1), 0)
  const secondHalfStarved =
    secondHalfFrames > 4 && secondHalf.compositedFrames * 3 < firstHalf.compositedFrames

  if (secondHalfStarved || biggestGap > secondHalfFrames / 2) {
    const cause = forceFastFlipped
      ? 'the continuous (fast-scrub) overlay dropped mid-window, switching to the buffered/Player path'
      : 'the transition compositing stopped'
    return `LIKELY BUG: second half barely renders (${secondHalf.compositedFrames} composited vs ${firstHalf.compositedFrames} in the first half; biggest stall ${biggestGap} frames) — ${cause}.`
  }
  if (forceFastFlipped) {
    return 'WARNING: forceFast changed within the window (overlay path switched mid-wipe); watch for a stall around the cut.'
  }
  return 'OK: transition composited consistently across both halves (no overlay path switch or large stall).'
}
