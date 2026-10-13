import { describe, expect, it } from 'vite-plus/test'
import { getBrowserMediaPlaybackRate, getNextShuttleRate } from './shuttle'

describe('shuttle playback', () => {
  it('ramps in one direction and resets to 1x on a direction flip', () => {
    expect(getNextShuttleRate(1, 1)).toBe(2)
    expect(getNextShuttleRate(2, 1)).toBe(4)
    expect(getNextShuttleRate(4, 1)).toBe(4)
    expect(getNextShuttleRate(4, -1)).toBe(-1)
    expect(getNextShuttleRate(-1, -1)).toBe(-2)
    expect(getNextShuttleRate(-2, -1)).toBe(-4)
    expect(getNextShuttleRate(-4, 1)).toBe(1)
  })

  it('multiplies authored media speed without exceeding browser-safe bounds', () => {
    expect(getBrowserMediaPlaybackRate(1.5, 2)).toBe(3)
    expect(getBrowserMediaPlaybackRate(4, 4)).toBe(16)
    expect(getBrowserMediaPlaybackRate(8, 4)).toBe(16)
    expect(getBrowserMediaPlaybackRate(0.01, 1)).toBe(0.0625)
  })
})
