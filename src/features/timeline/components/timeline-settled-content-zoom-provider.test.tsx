import { Profiler, Suspense } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { useTimelineContentPixelsPerSecond } from '../contexts/timeline-zoom-context'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import { TimelineSettledContentZoomProvider } from './timeline-settled-content-zoom-provider'

function PixelsPerSecondProbe({
  preferImmediateRendering = false,
}: {
  preferImmediateRendering?: boolean
}) {
  const pixelsPerSecond = useTimelineContentPixelsPerSecond(preferImmediateRendering)
  return <span data-testid="pixels-per-second">{pixelsPerSecond}</span>
}

describe('TimelineSettledContentZoomProvider', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps rich content settled while live zoom changes, then publishes the settled value', async () => {
    render(
      <TimelineSettledContentZoomProvider>
        <PixelsPerSecondProbe />
      </TimelineSettledContentZoomProvider>,
    )

    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('100')

    act(() => {
      useZoomStore.setState({
        level: 1.4,
        pixelsPerSecond: 140,
        isZoomInteracting: true,
      })
    })
    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('100')

    act(() => {
      useZoomStore.setState({
        contentLevel: 1.4,
        contentPixelsPerSecond: 140,
        isZoomInteracting: false,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('140')
    })
  })

  it('keeps immediate edit previews on live zoom', () => {
    render(
      <TimelineSettledContentZoomProvider>
        <PixelsPerSecondProbe preferImmediateRendering />
      </TimelineSettledContentZoomProvider>,
    )

    act(() => {
      useZoomStore.setState({
        level: 1.4,
        pixelsPerSecond: 140,
        isZoomInteracting: true,
      })
    })

    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('140')
  })

  it('does not commit a same-value bridge update when a settled gesture starts', () => {
    let updateCommits = 0
    render(
      <Profiler
        id="settled-content-zoom"
        onRender={(_id, phase) => {
          if (phase === 'update') updateCommits++
        }}
      >
        <TimelineSettledContentZoomProvider>
          <PixelsPerSecondProbe />
        </TimelineSettledContentZoomProvider>
      </Profiler>,
    )

    act(() => {
      useZoomStore.setState({
        level: 1.4,
        pixelsPerSecond: 140,
        isZoomInteracting: true,
      })
    })

    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('100')
    expect(updateCommits).toBe(0)
  })

  it('does not commit an obsolete settled transition after a new gesture starts', async () => {
    let allowObsoleteRender = false
    let releaseObsoleteRender: (() => void) | null = null
    const obsoleteRender = new Promise<void>((resolve) => {
      releaseObsoleteRender = () => {
        allowObsoleteRender = true
        resolve()
      }
    })

    function SuspendedProbe() {
      const pixelsPerSecond = useTimelineContentPixelsPerSecond()
      if (pixelsPerSecond === 140 && !allowObsoleteRender) {
        throw obsoleteRender
      }
      return <span data-testid="pixels-per-second">{pixelsPerSecond}</span>
    }

    render(
      <TimelineSettledContentZoomProvider>
        <Suspense fallback={<span data-testid="pixels-per-second">loading</span>}>
          <SuspendedProbe />
        </Suspense>
      </TimelineSettledContentZoomProvider>,
    )

    act(() => {
      useZoomStore.setState({
        level: 1.4,
        pixelsPerSecond: 140,
        contentLevel: 1.4,
        contentPixelsPerSecond: 140,
        isZoomInteracting: false,
      })
    })
    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('100')

    act(() => {
      useZoomStore.setState({
        level: 1.5,
        pixelsPerSecond: 150,
        isZoomInteracting: true,
      })
    })

    await act(async () => {
      releaseObsoleteRender?.()
      await obsoleteRender
    })
    expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('100')

    act(() => {
      useZoomStore.setState({
        contentLevel: 1.5,
        contentPixelsPerSecond: 150,
        isZoomInteracting: false,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('pixels-per-second')).toHaveTextContent('150')
    })
  })
})
