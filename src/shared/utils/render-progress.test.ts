// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { RenderProgress } from './render-progress'

/** Drive `frames` ticks at a steady `msPerFrame`, with a constant source gap. */
function run(
  p: RenderProgress,
  frames: number,
  msPerFrame: number,
  gap: number | null,
  startMs = 0,
) {
  let now = startMs
  for (let i = 0; i < frames; i++) {
    p.tick(now, i === 0 ? null : gap)
    now += msPerFrame
  }
  return now
}

describe('RenderProgress', () => {
  it('uses the fps hint before enough gaps have been seen', () => {
    const p = new RenderProgress(3, 30)
    p.tick(0, null)
    expect(p.estimatedTotalFrames).toBe(90)
  })

  it('re-derives the frame count from measured gaps, overriding a wrong hint', () => {
    // Caller says 30fps (the fastMetadata lie); the timestamps say 24fps.
    const p = new RenderProgress(10, 30)
    run(p, 6, 100, 1 / 24)
    expect(p.estimatedTotalFrames).toBe(240)
  })

  it('ignores a single outlier gap when deriving the rate', () => {
    const p = new RenderProgress(10, 30)
    p.tick(0, null)
    p.tick(10, 1 / 24)
    p.tick(20, 1 / 24)
    p.tick(30, 0.9) // dropped frame / scene cut
    p.tick(40, 1 / 24)
    p.tick(50, 1 / 24)
    expect(p.estimatedTotalFrames).toBe(240)
  })

  it('never reports a total below the frames already processed', () => {
    const p = new RenderProgress(0.1, 30) // claims 3 frames
    run(p, 20, 10, 1 / 30)
    expect(p.estimatedTotalFrames).toBeGreaterThanOrEqual(20)
    expect(p.fraction).toBeLessThanOrEqual(1)
  })

  it('clamps fraction to [0,1] and reaches 1 at the end', () => {
    const p = new RenderProgress(1, 10) // 10 frames
    run(p, 10, 5, 1 / 10)
    expect(p.fraction).toBe(1)
  })

  it('withholds an ETA until the warm-up frames are past', () => {
    const p = new RenderProgress(10, 30)
    p.tick(0, null)
    expect(p.etaSeconds).toBeNull()

    // The 0 -> 500ms interval is the session compile; it must not seed the estimate.
    p.tick(500, 1 / 30)
    expect(p.etaSeconds).toBeNull()

    // First interval that reflects steady-state cost.
    p.tick(600, 1 / 30)
    expect(p.etaSeconds).not.toBeNull()
    expect(p.etaSeconds!).toBeLessThan(60) // 100ms/frame, not 500ms/frame
  })

  it('does not let the slow first inference inflate the estimate', () => {
    const withCompile = new RenderProgress(10, 30)
    withCompile.tick(0, null)
    withCompile.tick(5000, 1 / 30) // 5s session compile
    for (let i = 2; i < 10; i++) withCompile.tick(5000 + (i - 1) * 100, 1 / 30)

    const withoutCompile = new RenderProgress(10, 30)
    run(withoutCompile, 10, 100, 1 / 30)

    // Both settle on ~100ms/frame; the compile spike must not linger in the EMA.
    expect(withCompile.etaSeconds!).toBeCloseTo(withoutCompile.etaSeconds!, 1)
  })

  it('estimates remaining time from the steady-state frame cost', () => {
    const p = new RenderProgress(10, 30) // 300 frames
    run(p, 100, 100, 1 / 30) // 100ms per frame
    // 200 frames left at ~100ms => ~20s
    expect(p.etaSeconds!).toBeGreaterThan(18)
    expect(p.etaSeconds!).toBeLessThan(22)
  })

  it('tracks a slowdown rather than clinging to the early rate', () => {
    const p = new RenderProgress(10, 30)
    let now = run(p, 20, 50, 1 / 30)
    const fast = p.etaSeconds!
    for (let i = 0; i < 40; i++) {
      p.tick(now, 1 / 30)
      now += 300 // render slows 6x
    }
    expect(p.etaSeconds!).toBeGreaterThan(fast)
  })

  it('reports zero remaining once every frame is processed', () => {
    const p = new RenderProgress(1, 10)
    run(p, 10, 20, 1 / 10)
    expect(p.etaSeconds).toBe(0)
  })

  it('survives a zero-length source without dividing by zero', () => {
    const p = new RenderProgress(0, 0)
    p.tick(0, null)
    expect(p.estimatedTotalFrames).toBe(1)
    expect(Number.isFinite(p.fraction)).toBe(true)
  })
})
