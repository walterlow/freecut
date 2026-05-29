import { describe, expect, it } from 'vite-plus/test'
import {
  analyzePreviewTrace,
  type PreviewTraceEvent,
  type PreviewTraceWindow,
} from './preview-trace'

// Window [100, 140), cut at 120 — 20 frames per half.
const WIN: PreviewTraceWindow = { startFrame: 100, cutPoint: 120, endFrame: 140 }

function pump(
  f: number,
  act: 'transition-overlay' | 'fast-scrub' | 'hide' | 'fallback-hide',
  forceFast: boolean,
): PreviewTraceEvent {
  return {
    ch: 'pump',
    f,
    act,
    shouldShow: act === 'transition-overlay',
    hasActive: true,
    hold: true,
    forceFast,
    fallback: false,
  }
}

function render(f: number): PreviewTraceEvent {
  return { ch: 'render', f, id: 'clipabcd', rev: false, src: f / 30, hasDom: false, useMb: true }
}

describe('analyzePreviewTrace', () => {
  it('reports OK when both halves render every frame with no path switch', () => {
    const events: PreviewTraceEvent[] = []
    for (let f = WIN.startFrame; f < WIN.endFrame; f++) {
      events.push(pump(f, 'fast-scrub', true))
      events.push(render(f))
    }
    const a = analyzePreviewTrace(events, WIN)
    expect(a.gapRanges).toEqual([])
    expect(a.forceFastFlipped).toBe(false)
    expect(a.secondHalf.compositedFrames).toBe(20)
    expect(a.verdict.startsWith('OK')).toBe(true)
  })

  it('flags the second-half collapse with a forceFast flip and a stall', () => {
    const events: PreviewTraceEvent[] = []
    // First half: smooth fast-scrub, composited every frame.
    for (let f = WIN.startFrame; f < WIN.cutPoint; f++) {
      events.push(pump(f, 'fast-scrub', true))
      events.push(render(f))
    }
    // Second half: overlay drops to the buffered path (forceFast=false), and a
    // long stretch is never rendered (the gap), then a couple of late frames.
    events.push(pump(120, 'transition-overlay', false))
    events.push(render(120))
    // frames 121..137 never rendered (gap)
    events.push(pump(138, 'transition-overlay', false))
    events.push(render(138))
    events.push(pump(139, 'transition-overlay', false))
    events.push(render(139))

    const a = analyzePreviewTrace(events, WIN)
    expect(a.forceFastFlipped).toBe(true)
    expect(a.firstHalf.compositedFrames).toBe(20)
    expect(a.secondHalf.compositedFrames).toBeLessThan(5)
    expect(a.gapRanges).toEqual([{ from: 121, to: 137 }])
    expect(a.verdict.startsWith('LIKELY BUG')).toBe(true)
  })

  it('ignores events outside the window', () => {
    const events: PreviewTraceEvent[] = [
      pump(50, 'fast-scrub', true),
      render(50),
      pump(200, 'fast-scrub', true),
      render(200),
    ]
    const a = analyzePreviewTrace(events, WIN)
    expect(a.firstHalf.compositedFrames).toBe(0)
    expect(a.secondHalf.compositedFrames).toBe(0)
    // Whole window is a gap when nothing rendered inside it.
    expect(a.gapRanges).toEqual([{ from: 100, to: 139 }])
  })
})
