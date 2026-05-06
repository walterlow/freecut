import { describe, expect, it } from 'vite-plus/test'
import {
  clampDraggedSourceInPoint,
  clampDraggedSourceOutPoint,
  getExclusiveSourceOutPoint,
  getSourcePointPercent,
  shiftSourceIoRange,
} from './source-io'

describe('source-io', () => {
  it('treats an out mark on the last frame as the end of the source clip', () => {
    expect(getExclusiveSourceOutPoint(149, 150)).toBe(150)
  })

  it('renders an EOF out point at 100 percent on the source strip', () => {
    expect(getSourcePointPercent(150, 150)).toBe(100)
  })

  it('keeps a dragged out point at least one frame past the in point', () => {
    expect(clampDraggedSourceOutPoint(75, 75, 150)).toBe(76)
  })

  it('keeps a dragged in point before the out point', () => {
    expect(clampDraggedSourceInPoint(150, 150, 149)).toBe(149)
  })

  it('slides a source range without truncating its duration at EOF', () => {
    expect(shiftSourceIoRange(120, 150, 20, 150)).toEqual({
      inPoint: 120,
      outPoint: 150,
    })
  })
})
