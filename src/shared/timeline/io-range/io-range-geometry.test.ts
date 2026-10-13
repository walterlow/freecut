// @vitest-environment node

import { describe, it, expect } from 'vite-plus/test'

import { computeIoGripWidth, IO_HANDLE_WIDTH } from './io-range-geometry'

describe('computeIoGripWidth', () => {
  it('uses the full nominal width for a lone marker (no span)', () => {
    expect(computeIoGripWidth(null)).toBe(IO_HANDLE_WIDTH)
    expect(computeIoGripWidth(null, 5)).toBe(5)
  })

  it('keeps the full width when the range is wider than two grips', () => {
    // 40px span: half is 20 > 6, so grips stay at the nominal width and leave a
    // gap between them.
    expect(computeIoGripWidth(40)).toBe(IO_HANDLE_WIDTH)
    expect(computeIoGripWidth(IO_HANDLE_WIDTH * 2)).toBe(IO_HANDLE_WIDTH)
  })

  it('shrinks each grip to half the range so they meet instead of overlapping', () => {
    // This is the collapse fix: below 2*width the grips would otherwise overlap
    // into a solid block. Each is capped to span/2 → they meet at the midpoint.
    expect(computeIoGripWidth(8)).toBe(4)
    expect(computeIoGripWidth(6)).toBe(3)
    expect(computeIoGripWidth(1)).toBe(0.5)
  })

  it('never returns a negative width for an inverted or zero range', () => {
    expect(computeIoGripWidth(0)).toBe(0)
    expect(computeIoGripWidth(-10)).toBe(0)
  })
})
