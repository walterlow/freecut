import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { repairTransitions } from './transition-auto-repair'

function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 't1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'c1',
    rightClipId: 'c2',
    trackId: 'v2',
    durationInFrames: 20,
    alignment: 0.5,
    ...overrides,
  }
}

describe('repairTransitions', () => {
  // Regression: composition clips support transitions (canAddTransition allows them),
  // so the repair pass must NOT remove a composition transition as `invalid_type` when
  // its clips move — e.g. when a whole track is reordered/swapped and both clips move
  // together to a new track. Previously VALID_TRANSITION_TYPES omitted 'composition'.
  it('keeps a composition-to-composition transition when both clips move together', () => {
    // Two trimmed composition clips with real source handles (so the transition is
    // genuinely valid), now relocated to a new track at the same relative positions.
    const comp = (id: string, from: number): TimelineItem =>
      ({
        id,
        type: 'composition',
        trackId: 'v2', // both moved to the same new track
        from,
        durationInFrames: 60,
        label: id,
        compositionId: 'comp-x',
        sourceStart: 30,
        sourceEnd: 90,
        sourceDuration: 120,
      }) as unknown as TimelineItem

    const items = [comp('c1', 0), comp('c2', 60)]
    const transition = makeTransition()

    const result = repairTransitions(['c1', 'c2'], items, [transition])

    expect(result.broken).toHaveLength(0)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]?.id).toBe('t1')
  })

  it('still removes a transition whose clips genuinely landed on different tracks', () => {
    const make = (id: string, trackId: string, from: number): TimelineItem =>
      ({
        id,
        type: 'video',
        trackId,
        from,
        durationInFrames: 60,
        label: id,
        src: 'blob:v',
        mediaId: 'm',
        sourceStart: 30,
        sourceEnd: 90,
        sourceDuration: 120,
      }) as unknown as TimelineItem

    const items = [make('c1', 'v1', 0), make('c2', 'v2', 60)]
    const result = repairTransitions(['c1', 'c2'], items, [makeTransition({ trackId: 'v1' })])

    expect(result.valid).toHaveLength(0)
    expect(result.broken).toHaveLength(1)
    expect(result.broken[0]?.reason).toBe('cross_track')
  })
})
