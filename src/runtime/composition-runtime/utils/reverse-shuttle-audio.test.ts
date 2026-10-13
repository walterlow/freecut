// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { copyShuttleGrainSamples, resolveReverseShuttleGrainPlan } from './reverse-shuttle-audio'

describe('reverse shuttle audio', () => {
  it('maps signed reverse transport to a pitch-shifted backward source window', () => {
    expect(
      resolveReverseShuttleGrainPlan({
        sourceCursorSeconds: 4,
        authoredPlaybackRate: 1,
        transportPlaybackRate: -4,
        authoredReversed: false,
        bufferStartSeconds: 0,
        bufferDurationSeconds: 10,
        outputDurationSeconds: 0.08,
      }),
    ).toEqual({
      sourceStartSeconds: 3.68,
      sourceDurationSeconds: 0.32,
      playbackRate: 4,
      reverseSamples: true,
      nextSourceCursorSeconds: 3.68,
    })
  })

  it('moves forward through an authored-reversed clip while transport runs backward', () => {
    const plan = resolveReverseShuttleGrainPlan({
      sourceCursorSeconds: 4,
      authoredPlaybackRate: 1,
      transportPlaybackRate: -2,
      authoredReversed: true,
      bufferStartSeconds: 0,
      bufferDurationSeconds: 10,
      outputDurationSeconds: 0.08,
    })
    expect(plan?.reverseSamples).toBe(false)
    expect(plan?.nextSourceCursorSeconds).toBeCloseTo(4.16)
  })

  it('stops cleanly at decoded-buffer bounds', () => {
    expect(
      resolveReverseShuttleGrainPlan({
        sourceCursorSeconds: 0.1,
        authoredPlaybackRate: 1,
        transportPlaybackRate: -4,
        authoredReversed: false,
        bufferStartSeconds: 0,
        bufferDurationSeconds: 10,
      }),
    ).toBeNull()
  })

  it('copies a bounded PCM window in reverse without mutating the source', () => {
    const source = new Float32Array([0, 1, 2, 3, 4])
    const target = new Float32Array(3)
    copyShuttleGrainSamples(source, target, 1, true)
    expect([...target]).toEqual([3, 2, 1])
    expect([...source]).toEqual([0, 1, 2, 3, 4])
  })
})
