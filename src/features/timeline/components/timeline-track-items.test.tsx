import { Profiler } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../stores/timeline-store'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'

vi.mock('./timeline-item', () => ({
  TimelineItem: ({
    item,
    isCompactWidth,
    isDetailEligible,
  }: {
    item: TimelineItem
    isCompactWidth: boolean
    isDetailEligible: boolean
  }) => (
    <div
      data-item-id={item.id}
      data-rich-item-id={item.id}
      data-compact-width={String(isCompactWidth)}
      data-detail-eligible={String(isDetailEligible)}
    />
  ),
}))

import { TimelineTrackItems } from './timeline-track-items'

const items: TimelineItem[] = [
  {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'One',
    mediaId: 'media-1',
    src: 'blob:one',
  },
  {
    id: 'item-2',
    type: 'image',
    trackId: 'track-1',
    from: 35,
    durationInFrames: 30,
    label: 'Two',
    mediaId: 'media-2',
    src: 'blob:two',
  },
]

describe('TimelineTrackItems stable DOM renderer', () => {
  beforeEach(() => {
    useTimelineStore.setState({ fps: 30 })
    useSelectionStore.getState().selectItems([])
    _resetZoomStoreForTest()
  })

  it('keeps rich clip nodes mounted across rerenders', () => {
    const view = render(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={items}
        trackLocked={false}
        trackHidden={false}
      />,
    )
    const firstItem = view.container.querySelector('[data-rich-item-id="item-1"]')

    view.rerender(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={[...items]}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(2)
    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBe(firstItem)
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(view.container.querySelector('[data-timeline-hit-target="true"]')).toBeNull()
  })

  it('ignores live zoom ticks and publishes compact width only at settle', async () => {
    useZoomStore.setState({
      contentLevel: 0.3,
      contentPixelsPerSecond: 30,
    })
    const onRender = vi.fn()
    const view = render(
      <Profiler id="track-items" onRender={onRender}>
        <TimelineTrackItems
          trackId="track-1"
          trackItems={items}
          trackLocked={false}
          trackHidden={false}
        />
      </Profiler>,
    )
    const firstItem = view.container.querySelector('[data-rich-item-id="item-1"]')
    const initialCommitCount = onRender.mock.calls.length

    expect(firstItem).toHaveAttribute('data-compact-width', 'true')

    act(() => {
      useZoomStore.setState({
        level: 2,
        pixelsPerSecond: 200,
        isZoomInteracting: true,
      })
    })

    expect(onRender).toHaveBeenCalledTimes(initialCommitCount + 1)
    expect(firstItem).toHaveAttribute('data-compact-width', 'true')

    act(() => {
      useZoomStore.setState({
        contentLevel: 1,
        contentPixelsPerSecond: 100,
        isZoomInteracting: false,
      })
    })

    expect(onRender).toHaveBeenCalledTimes(initialCommitCount + 2)
    await waitFor(() => expect(firstItem).toHaveAttribute('data-compact-width', 'false'))
    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBe(firstItem)
  })

  it('mounts a newly exposed zoom-out cohort directly as compact shells', () => {
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
    const view = render(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={[items[0]!]}
        trackLocked={false}
        trackHidden={false}
      />,
    )
    const firstItem = view.container.querySelector('[data-rich-item-id="item-1"]')

    expect(firstItem).toHaveAttribute('data-compact-width', 'false')

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })

    // The track publishes only the compact-cohort boundary, not every live PPS.
    expect(firstItem).toHaveAttribute('data-compact-width', 'true')

    view.rerender(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={items}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    const firstCompactItem = view.container.querySelector('[data-rich-item-id="item-1"]')
    const secondCompactItem = view.container.querySelector('[data-rich-item-id="item-2"]')
    expect(firstCompactItem).toHaveAttribute('data-compact-width', 'true')
    expect(secondCompactItem).toHaveAttribute('data-compact-width', 'true')

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.1,
        contentPixelsPerSecond: 10,
        isZoomInteracting: false,
      })
    })

    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBe(firstCompactItem)
    expect(view.container.querySelector('[data-rich-item-id="item-2"]')).toBe(secondCompactItem)
  })

  it('restores a newly exposed cohort after a net-zero zoom reversal', async () => {
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
    const view = render(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={[items[0]!]}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })
    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toHaveAttribute(
      'data-compact-width',
      'true',
    )
    view.rerender(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={items}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    const firstItem = view.container.querySelector('[data-rich-item-id="item-1"]')
    const secondItem = view.container.querySelector('[data-rich-item-id="item-2"]')
    expect(firstItem).toHaveAttribute('data-compact-width', 'true')
    expect(secondItem).toHaveAttribute('data-compact-width', 'true')

    act(() => {
      useZoomStore.setState({
        level: 50,
        pixelsPerSecond: 5000,
        isZoomInteracting: true,
      })
      useZoomStore.setState({
        contentLevel: 50,
        contentPixelsPerSecond: 5000,
        isZoomInteracting: false,
      })
    })

    await waitFor(() => expect(firstItem).toHaveAttribute('data-compact-width', 'false'))
    // The retained root survives the reversal but remains cheap while it is
    // outside the current detail window.
    expect(secondItem).toHaveAttribute('data-compact-width', 'true')
    expect(secondItem).toHaveAttribute('data-detail-eligible', 'false')
    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBe(firstItem)
    expect(view.container.querySelector('[data-rich-item-id="item-2"]')).toBe(secondItem)
  })

  it('uses lightweight shells for a normal dense track', () => {
    useZoomStore.setState({
      level: 0.1,
      pixelsPerSecond: 10,
      contentLevel: 0.1,
      contentPixelsPerSecond: 10,
      isZoomInteracting: false,
    })
    const denseItems = Array.from({ length: 80 }, (_, index) => ({
      ...items[0]!,
      id: `dense-${index}`,
      from: index * 30,
    }))
    const view = render(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={denseItems}
        totalTrackItemCount={80}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(0)
    expect(view.container.querySelectorAll('[data-timeline-density-bucket]')).toHaveLength(80)

    act(() => useSelectionStore.getState().selectItems(['dense-10']))

    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(1)
    expect(view.container.querySelector('[data-rich-item-id="dense-10"]')).not.toBeNull()
    expect(view.container.querySelectorAll('[data-timeline-density-bucket]')).toHaveLength(80)
  })

  it('compresses a 30,000 item track into a bounded overview surface', () => {
    useZoomStore.setState({
      level: 0.1,
      pixelsPerSecond: 10,
      contentLevel: 0.1,
      contentPixelsPerSecond: 10,
      isZoomInteracting: false,
    })
    const overviewItems = Array.from({ length: 30_000 }, (_, index) => ({
      ...items[0]!,
      id: `overview-${index}`,
      from: index * 30,
    }))
    const view = render(
      <TimelineTrackItems
        trackId="track-1"
        trackItems={overviewItems}
        totalTrackItemCount={30_000}
        trackLocked={false}
        trackHidden={false}
      />,
    )

    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(0)
    expect(
      view.container.querySelectorAll('[data-timeline-density-bucket]').length,
    ).toBeLessThanOrEqual(1024)
    expect(view.container.querySelector('[data-timeline-density-overview]')).toHaveAttribute(
      'data-density-bucket-count',
      '1000',
    )

    const initialDensityOverview = view.container.querySelector('[data-timeline-density-overview]')
    act(() => {
      useSelectionStore.getState().selectItems(overviewItems.slice(0, 128).map((item) => item.id))
    })

    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(128)
    expect(view.container.querySelector('[data-timeline-density-overview]')).toBe(
      initialDensityOverview,
    )
    expect(view.container.querySelector('[data-timeline-density-overview]')).toHaveAttribute(
      'data-density-bucket-count',
      '1000',
    )
  })
})
