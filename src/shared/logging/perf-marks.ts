/**
 * Thin wrappers over the User Timing API (`performance.mark` / `performance.measure`).
 *
 * Entries land on the "Timings" / "User Timing" track in Chrome DevTools
 * Performance, so named timeline hotspots show up as labeled bars instead of
 * minified flame-chart frames. Safe in production — the underlying APIs are
 * noop-fast browser primitives.
 */

const HAS_PERF =
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.measure === 'function'

export function perfMark(name: string): void {
  if (!HAS_PERF) return
  try {
    performance.mark(name)
  } catch {
    // ignore — bad name / detached buffer
  }
}

/**
 * Mark a React component render with a `tl.render.<name>` instant mark. The
 * count of these marks during a gesture reveals which components are doing the
 * bulk of the per-zoom (or per-anything) re-render work.
 *
 * Opt-in: fires only when `window.__TL_RENDER_MARKS__` is truthy, so it adds
 * zero overhead (and no unbounded mark-buffer growth) in normal use. Enable it
 * from the console before profiling: `window.__TL_RENDER_MARKS__ = true`.
 */
export function perfMarkRender(name: string): void {
  if (!HAS_PERF) return
  if (!(globalThis as { __TL_RENDER_MARKS__?: boolean }).__TL_RENDER_MARKS__) return
  try {
    performance.mark(`tl.render.${name}`)
  } catch {
    // ignore
  }
}

export function perfMeasure(name: string, startMark: string, endMark?: string): void {
  if (!HAS_PERF) return
  try {
    performance.measure(name, startMark, endMark)
  } catch {
    // ignore — missing start mark
  }
}

/**
 * Measure the synchronous duration of `fn` under `name`. Shows up as a
 * single labeled entry on the User Timing track.
 *
 * Opt-in: records only when `window.__TL_PERF__` is truthy. Each call leaves a
 * `performance.measure` entry in the buffer (the marks are cleared, the measure
 * is not — that's what `__DEBUG__.perfSummary()` reads), so leaving it always-on
 * grows the User Timing buffer unbounded over a session. Gating it (like
 * `perfMarkRender`) keeps normal use zero-overhead; enable before profiling:
 * `window.__TL_PERF__ = true`.
 */
let perfMeasureCounter = 0

export function withPerfMeasure<T>(name: string, fn: () => T): T {
  if (!HAS_PERF || !(globalThis as { __TL_PERF__?: boolean }).__TL_PERF__) return fn()
  const unique = ++perfMeasureCounter
  const startMark = `${name}:s:${unique}`
  const endMark = `${name}:e:${unique}`
  try {
    performance.mark(startMark)
  } catch {
    return fn()
  }
  try {
    return fn()
  } finally {
    try {
      performance.mark(endMark)
      performance.measure(name, startMark, endMark)
      performance.clearMarks(startMark)
      performance.clearMarks(endMark)
    } catch {
      // ignore
    }
  }
}
