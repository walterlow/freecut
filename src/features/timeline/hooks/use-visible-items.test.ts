import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'

import { useVisibleItemDetailRange, useVisibleItems } from './use-visible-items'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTimelineViewportStore, _resetViewportThrottle } from '../stores/timeline-viewport-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import {
  DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX,
  DENSE_TIMELINE_TRACK_ITEM_THRESHOLD,
} from '../utils/timeline-dom-density'

function makeItem(id: string, from: number, duration: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames: duration,
    label: `${id}.mp4`,
    src: 'blob:test',
    mediaId: `media-${id}`,
  } as VideoItem
}

function makeAudioItem(
  id: string,
  from: number,
  duration: number,
  trackId = 'audio-track',
): AudioItem {
  return {
    id,
    type: 'audio',
    trackId,
    from,
    durationInFrames: duration,
    label: `${id}.wav`,
    src: 'blob:test-audio',
    mediaId: `media-${id}`,
  } as AudioItem
}

function makeTrack(id: string, kind: 'video' | 'audio'): TimelineTrack {
  return {
    id,
    name: kind === 'video' ? 'V1' : 'A1',
    kind,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: kind === 'video' ? 0 : 1,
    items: [],
  }
}

function VisibleItemsProbe({ onRender }: { onRender: (itemIds: string[]) => void }) {
  const { visibleItems } = useVisibleItems('track-1')
  const itemIds = visibleItems.map((item) => item.id)
  onRender(itemIds)
  return createElement('div', { 'data-testid': 'visible-items' }, itemIds.join(','))
}

function DetailRangeProbe() {
  const { visibleItems } = useVisibleItems('track-1')
  const detailRange = useVisibleItemDetailRange('track-1')
  return createElement('div', {
    'data-testid': 'detail-range',
    'data-detail-start': String(detailRange.start),
    'data-detail-end': String(detailRange.end),
    'data-visible-items': visibleItems.map((item) => item.id).join(','),
  })
}

function VisibleTransitionsProbe({
  trackId,
  onRender,
}: {
  trackId: string
  onRender: (transitionIds: string[]) => void
}) {
  const { visibleTransitions } = useVisibleItems(trackId)
  const transitionIds = visibleTransitions.map((transition) => transition.id)
  onRender(transitionIds)
  return createElement(
    'div',
    { 'data-testid': `visible-transitions-${trackId}` },
    transitionIds.join(','),
  )
}

/** Replicate the hook's frame range calculation */
function getVisibleFrameRange(
  scrollLeft: number,
  viewportWidth: number,
  pps: number,
  fps: number,
  buffer = DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX,
) {
  const leftPx = scrollLeft - buffer
  const rightPx = scrollLeft + viewportWidth + buffer
  return {
    start: Math.max(0, Math.floor((leftPx / pps) * fps)),
    end: Math.ceil((rightPx / pps) * fps),
  }
}

function filterItems(items: VideoItem[], range: { start: number; end: number }) {
  return items.filter((item) => {
    const itemEnd = item.from + item.durationInFrames
    return itemEnd > range.start && item.from < range.end
  })
}

describe('useVisibleItems filtering logic', () => {
  const fps = 30
  const pps = 100

  beforeEach(() => {
    useTimelineSettingsStore.setState({
      fps,
      scrollPosition: 0,
      snapEnabled: true,
      isDirty: false,
      isTimelineLoading: false,
    })
    _resetZoomStoreForTest()
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    })
  })

  it('includes items that overlap the viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps)
    const items = [makeItem('a', 0, 30), makeItem('b', 30, 60), makeItem('c', 300, 30)]
    const visible = filterItems(items, range)
    expect(visible.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes items fully outside the buffered viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps)
    const items = [makeItem('a', 0, 30), makeItem('b', 1000, 30)]
    const visible = filterItems(items, range)
    expect(visible.map((item) => item.id)).toEqual(['a'])
  })

  it('includes items partially overlapping the left edge', () => {
    const range = getVisibleFrameRange(4000, 1000, pps, fps)
    const items = [makeItem('a', 590, 30), makeItem('b', 0, 30)]
    const visible = filterItems(items, range)
    expect(visible.map((item) => item.id)).toEqual(['a'])
  })

  it('returns empty array when no items exist', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps)
    expect(filterItems([], range)).toEqual([])
  })

  it('uses the stable dense-track buffer to avoid mounting distant split shells', () => {
    const denseItems = Array.from({ length: DENSE_TIMELINE_TRACK_ITEM_THRESHOLD }, (_, index) =>
      makeItem(`dense-${index}`, index * 30, 30),
    )
    useItemsStore.getState().setItems(denseItems)

    render(createElement(VisibleItemsProbe, { onRender: vi.fn() }))

    const visibleIds = screen.getByTestId('visible-items').textContent?.split(',').filter(Boolean)
    expect(visibleIds).toHaveLength(16)
    expect(visibleIds?.at(-1)).toBe('dense-15')
  })

  it('does not re-render when scroll stays within the same visible item window', () => {
    // Use fake timers so the viewport store's scroll throttle fires
    // synchronously when we advance time within act(). Reset throttle
    // state so fake-timer performance.now() is consistent.
    vi.useFakeTimers()
    _resetViewportThrottle()

    // Re-set viewport with fake timers active so lastScrollUpdate
    // is in fake-timer space.
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    })

    useItemsStore
      .getState()
      .setItems([makeItem('a', 0, 30), makeItem('b', 300, 30), makeItem('c', 900, 30)])

    const onRender = vi.fn()
    render(createElement(VisibleItemsProbe, { onRender }))

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b')
    expect(onRender).toHaveBeenCalledTimes(1)

    // Small scroll — stays within same visible item window
    act(() => {
      vi.advanceTimersByTime(100)
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 100,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      })
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b')
    expect(onRender).toHaveBeenCalledTimes(1)

    // Large scroll — different visible items
    act(() => {
      vi.advanceTimersByTime(100)
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 2000,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      })
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent('c')
    expect(onRender).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('keeps the mounted item set stable through zoom settle and prunes after quiet', () => {
    vi.useFakeTimers()

    useItemsStore.getState().setItems([
      makeItem('a', 0, 30),
      makeItem('b', 500, 30), // at 2x zoom: pixel 3333 — outside [0,3000] buffered range
    ])

    const onRender = vi.fn()
    render(createElement(VisibleItemsProbe, { onRender }))

    expect(screen.getByTestId('visible-items')).toHaveTextContent(/^a,b$/)
    expect(onRender).toHaveBeenCalledTimes(1)

    // Zoom in — keep the mounted set stable during the interaction so clips do
    // not thrash in and out while the live geometry is still moving.
    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent(/^a,b$/)
    expect(onRender).toHaveBeenCalledTimes(1)

    // The 200ms content settle does not retire a large cohort in the same task.
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent(/^a,b$/)
    expect(onRender).toHaveBeenCalledTimes(1)

    // Offscreen surplus retires later under the shared per-frame budget.
    act(() => {
      vi.advanceTimersByTime(620)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent(/^a$/)
    expect(onRender).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('shrinks the live detail range before the retained root cohort is pruned', () => {
    vi.useFakeTimers()

    useItemsStore.getState().setItems([makeItem('a', 0, 30), makeItem('b', 500, 30)])

    render(createElement(DetailRangeProbe))
    const probe = screen.getByTestId('detail-range')
    expect(probe).toHaveAttribute('data-visible-items', 'a,b')
    expect(Number(probe.getAttribute('data-detail-end'))).toBeGreaterThan(500)

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2)
    })

    expect(probe).toHaveAttribute('data-visible-items', 'a,b')
    expect(Number(probe.getAttribute('data-detail-end'))).toBeLessThan(500)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    // The rich-detail window is already narrow at content settle, while the
    // offscreen root remains mounted for a quick slider reversal.
    expect(probe).toHaveAttribute('data-visible-items', 'a,b')
    expect(Number(probe.getAttribute('data-detail-end'))).toBeLessThan(500)

    vi.useRealTimers()
  })

  it('defers a disjoint live-zoom range until anchored scroll is synchronized', () => {
    useTimelineViewportStore.setState({
      scrollLeft: 10_000,
      viewportWidth: 1_000,
    })
    useItemsStore.getState().setItems([makeItem('anchored', 3_000, 30)])

    render(createElement(VisibleItemsProbe, { onRender: vi.fn() }))
    expect(screen.getByTestId('visible-items')).toHaveTextContent('anchored')

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(5)
    })

    // The zoom notification arrives before TimelineContent writes its matching
    // playhead-anchored scroll offset. Keep the old root through that transient.
    expect(screen.getByTestId('visible-items')).toHaveTextContent('anchored')

    useTimelineViewportStore.setState({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1_000,
      viewportHeight: 120,
    })
  })

  it('retires a dense zoom-in surplus under the shared per-frame budget', () => {
    vi.useFakeTimers()

    const denseItems = Array.from({ length: DENSE_TIMELINE_TRACK_ITEM_THRESHOLD }, (_, index) =>
      makeItem(`dense-${index}`, index * 30, 30),
    )
    useItemsStore.getState().setItems(denseItems)

    render(createElement(VisibleItemsProbe, { onRender: vi.fn() }))

    const getVisibleIds = () =>
      screen.getByTestId('visible-items').textContent?.split(',').filter(Boolean) ?? []

    expect(getVisibleIds()).toHaveLength(16)

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2)
      vi.advanceTimersByTime(200)
    })

    // Content zoom has settled, but dense culling still gets a short independent
    // quiet window so the commit task does not also tear down rich clip trees.
    expect(getVisibleIds()).toHaveLength(16)

    act(() => {
      vi.advanceTimersByTime(136)
    })

    // One shared animation frame retires at most four clips across all tracks.
    expect(getVisibleIds()).toHaveLength(12)

    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(getVisibleIds()).toHaveLength(8)

    vi.useRealTimers()
  })

  it('cancels a pending dense contraction when a new zoom gesture starts', () => {
    vi.useFakeTimers()

    const denseItems = Array.from({ length: DENSE_TIMELINE_TRACK_ITEM_THRESHOLD }, (_, index) =>
      makeItem(`dense-${index}`, index * 30, 30),
    )
    useItemsStore.getState().setItems(denseItems)

    const onRender = vi.fn()
    render(createElement(VisibleItemsProbe, { onRender }))

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2)
      vi.advanceTimersByTime(200)
      vi.advanceTimersByTime(80)
      useZoomStore.getState().setZoomLevelImmediate(1)
      vi.advanceTimersByTime(200)
    })

    const visibleIds =
      screen.getByTestId('visible-items').textContent?.split(',').filter(Boolean) ?? []
    expect(visibleIds).toHaveLength(16)
    expect(onRender).toHaveBeenCalledTimes(1)

    // The canceled first timer cannot wake later and retire clips against the
    // newer settled zoom target.
    act(() => {
      vi.advanceTimersByTime(620)
    })
    expect(
      screen.getByTestId('visible-items').textContent?.split(',').filter(Boolean),
    ).toHaveLength(16)
    expect(onRender).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('expands the mounted item set during live zoom-out before settle', () => {
    vi.useFakeTimers()

    useZoomStore.setState({
      level: 2,
      pixelsPerSecond: 200,
      contentLevel: 2,
      contentPixelsPerSecond: 200,
      isZoomInteracting: false,
    })
    useItemsStore.getState().setItems([
      makeItem('a', 0, 30),
      makeItem('b', 700, 30), // outside at 2x zoom, visible again once we zoom out
      makeItem('c', 940, 30),
    ])

    const onRender = vi.fn()
    render(createElement(VisibleItemsProbe, { onRender }))

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a')
    expect(onRender).toHaveBeenCalledTimes(1)

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(1)
    })

    // Staged: newly-visible clips mount on subsequent animation frames (under a
    // global per-frame budget) rather than all at once, so the set is unchanged
    // synchronously.
    expect(screen.getByTestId('visible-items')).toHaveTextContent('a')

    // Animation frames before the 200ms settle: the staged expansion mounts the
    // newly-visible clip — so it does NOT wait for settle.
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b')

    // Settle recomputes in the committed coordinate space; the set stays 'a,b'.
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b')

    vi.useRealTimers()
  })

  it('does not synthesize transition bridges on audio tracks for linked companions', () => {
    const transition: Transition = {
      id: 'tr-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'video-1',
      rightClipId: 'video-2',
      trackId: 'video-track',
      durationInFrames: 20,
    }

    useItemsStore
      .getState()
      .setTracks([makeTrack('video-track', 'video'), makeTrack('audio-track', 'audio')])
    useItemsStore
      .getState()
      .setItems([
        makeItem('video-1', 0, 60),
        makeAudioItem('audio-1', 0, 60),
        makeItem('video-2', 60, 60),
        makeAudioItem('audio-2', 60, 60),
      ])
    useTransitionsStore.getState().setTransitions([transition])

    const onRender = vi.fn()
    render(createElement(VisibleTransitionsProbe, { trackId: 'audio-track', onRender }))

    expect(screen.getByTestId('visible-transitions-audio-track')).toHaveTextContent('')
    expect(onRender).toHaveBeenCalledWith([])
  })
})
