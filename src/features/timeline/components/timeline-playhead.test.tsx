import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePlayhead } from './timeline-playhead'
import { useZoomStore, _resetZoomStoreForTest } from '../stores/zoom-store'
import { useTimelineStore } from '../stores/timeline-store'

describe('TimelinePlayhead', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 12,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    })
    useTimelineStore.setState({ fps: 30 })
    _resetZoomStoreForTest()
    useZoomStore.getState().setZoomLevelSynchronized(1)
  })

  it('uses atomic scrub updates while dragging and clears preview on release', async () => {
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )

    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement | null
    expect(ruler).toBeTruthy()

    ruler!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })

    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement | null
    expect(hitArea).toBeTruthy()

    fireEvent.mouseDown(hitArea!, { clientX: 24, clientY: 8, button: 0 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 8 })

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(36)
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
    })

    fireEvent.mouseUp(document, { clientX: 120, clientY: 8 })

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
      expect(usePlaybackStore.getState().previewFrame).toBeNull()
    })
  })
})
