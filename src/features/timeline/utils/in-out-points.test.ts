import { describe, expect, it } from 'vite-plus/test'

import { getEffectiveTimelineMaxFrame, sanitizeInOutPoints } from './in-out-points'

describe('in/out point helpers', () => {
  it('keeps the timeline minimum duration when content is shorter', () => {
    expect(getEffectiveTimelineMaxFrame([], 30)).toBe(300)
  })

  it('clamps a stale out-point back to the project end', () => {
    expect(
      sanitizeInOutPoints({
        inPoint: 120,
        outPoint: 5000,
        maxFrame: 600,
      }),
    ).toEqual({
      inPoint: 120,
      outPoint: 600,
    })
  })

  it('repairs inverted ranges without leaving a zero-width span', () => {
    expect(
      sanitizeInOutPoints({
        inPoint: 600,
        outPoint: 200,
        maxFrame: 600,
      }),
    ).toEqual({
      inPoint: 599,
      outPoint: 600,
    })
  })
})
