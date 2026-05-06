import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { getRollingEditPanelFrames } from './rolling-edit-overlay-utils'

function makeVideoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'Clip',
    src: 'clip.mp4',
    sourceStart: 0,
    sourceEnd: 200,
    sourceDuration: 200,
    sourceFps: 30,
    ...overrides,
  } as TimelineItem
}

describe('getRollingEditPanelFrames', () => {
  it('shows earlier incoming source frames when the edit point rolls left', () => {
    const trimmedItem = makeVideoItem({
      id: 'left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
    })
    const neighborItem = makeVideoItem({
      id: 'right',
      from: 100,
      durationInFrames: 100,
      sourceStart: 50,
    })

    const result = getRollingEditPanelFrames({
      trimmedItem,
      neighborItem,
      handle: 'end',
      neighborDelta: -30,
      fps: 30,
    })

    expect(result.leftItem.id).toBe('left')
    expect(result.rightItem.id).toBe('right')
    expect(result.outInfo.sourceFrame).toBe(69)
    expect(result.inInfo.sourceFrame).toBe(20)
  })

  it('shows later incoming source frames when the edit point rolls right from a start handle drag', () => {
    const neighborItem = makeVideoItem({
      id: 'left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
    })
    const trimmedItem = makeVideoItem({
      id: 'right',
      from: 100,
      durationInFrames: 100,
      sourceStart: 40,
    })

    const result = getRollingEditPanelFrames({
      trimmedItem,
      neighborItem,
      handle: 'start',
      neighborDelta: 12,
      fps: 30,
    })

    expect(result.leftItem.id).toBe('left')
    expect(result.rightItem.id).toBe('right')
    expect(result.outInfo.sourceFrame).toBe(111)
    expect(result.inInfo.sourceFrame).toBe(52)
  })
})
