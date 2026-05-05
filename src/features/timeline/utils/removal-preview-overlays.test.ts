import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTimelineItemOverlayStore } from '@/features/timeline/stores/timeline-item-overlay-store'
import { applySilencePreviewOverlays } from './silence-removal-preview'
import { applyFillerPreviewOverlays } from './filler-word-removal-preview'

function audioItem(id: string, mediaId: string): TimelineItem {
  return {
    id,
    type: 'audio',
    name: id,
    trackId: 'track-1',
    from: 30,
    durationInFrames: 90,
    mediaId,
    sourceStart: 0,
    sourceDuration: 90,
    sourceFps: 30,
  } as unknown as TimelineItem
}

beforeEach(() => {
  useTimelineSettingsStore.setState({ fps: 30 })
  useItemsStore.getState().setItems([audioItem('item-1', 'media-1')])
  useTimelineItemOverlayStore.setState({ overlaysByItemId: {} })
})

describe('removal preview overlays', () => {
  it('preserves silence preview overlay labels, tone, ranges, and summary', () => {
    const summary = applySilencePreviewOverlays(['item-1'], {
      'media-1': [{ start: 1.5, end: 2.5 }],
    })

    expect(summary.rangeCount).toBe(1)
    expect(summary.totalSeconds).toBeCloseTo(1)
    expect(useTimelineItemOverlayStore.getState().overlaysByItemId['item-1']).toEqual([
      {
        id: 'silence-removal-preview',
        label: '1 silent range',
        tone: 'error',
        ranges: [{ startRatio: 0.5, endRatio: 0.8333333333333334 }],
      },
    ])
  })

  it('preserves filler preview overlay labels, tone, ranges, and summary', () => {
    const summary = applyFillerPreviewOverlays(['item-1'], {
      'media-1': [
        { start: 1.5, end: 2.0, text: 'um' },
        { start: 2.2, end: 2.5, text: 'like' },
      ],
    })

    expect(summary).toEqual({ rangeCount: 2, totalSeconds: 0.8 })
    expect(useTimelineItemOverlayStore.getState().overlaysByItemId['item-1']).toEqual([
      {
        id: 'filler-word-removal-preview',
        label: '2 filler ranges',
        tone: 'warning',
        ranges: [
          { startRatio: 0.5, endRatio: 0.6666666666666666 },
          { startRatio: 0.7333333333333333, endRatio: 0.8333333333333334 },
        ],
      },
    ])
  })
})
