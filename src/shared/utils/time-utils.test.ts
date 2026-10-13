// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { formatTimecodeDotFrames } from './time-utils'

describe('formatTimecodeDotFrames', () => {
  it('formats sub-minute durations as MM:SS.FF', () => {
    expect(formatTimecodeDotFrames(0, 30)).toBe('00:00.00')
    // 45 frames at 30fps = 1s 15f
    expect(formatTimecodeDotFrames(45, 30)).toBe('00:01.15')
  })

  it('rolls over into hours once the duration reaches an hour', () => {
    // Regression: previously produced total-minutes with no hour rollover
    // (e.g. "97:27.24"). 175434 frames at 30fps = 1h 37m 27s 24f.
    expect(formatTimecodeDotFrames(175434, 30)).toBe('01:37:27.24')
  })

  it('omits the hours segment below one hour', () => {
    // 59m 59s 29f at 30fps — still MM:SS.FF, no leading hours
    expect(formatTimecodeDotFrames(60 * 60 * 30 - 1, 30)).toBe('59:59.29')
  })

  it('shows hours at exactly one hour', () => {
    expect(formatTimecodeDotFrames(60 * 60 * 30, 30)).toBe('01:00:00.00')
  })
})
