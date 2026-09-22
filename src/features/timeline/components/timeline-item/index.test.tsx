import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSelectionStore } from '@/shared/state/selection'
import { useSettingsStore } from '../../deps/settings'
import { dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag'
import { makeTimelineTrack, makeTimelineVideoItem, setTimelineState } from '../../test-helpers'
import { TimelineItem } from './index'

vi.mock('../clip-filmstrip', () => ({
  ClipFilmstrip: () => <div data-testid="clip-filmstrip" />,
}))

vi.mock('../clip-filmstrip/image-filmstrip', () => ({
  ImageFilmstrip: () => <div data-testid="image-filmstrip" />,
}))

vi.mock('../clip-waveform', () => ({
  ClipWaveform: () => <div data-testid="clip-waveform" />,
}))

vi.mock('../clip-waveform/compound-clip-waveform', () => ({
  CompoundClipWaveform: () => <div data-testid="compound-clip-waveform" />,
}))

const TRACK_ID = 'track-v1'
const ITEM_ID = 'video-1'

const VIDEO_ITEM = makeTimelineVideoItem({
  id: ITEM_ID,
  trackId: TRACK_ID,
  from: 0,
  durationInFrames: 60,
  label: 'clip.mp4',
})

function getShell(container: HTMLElement): HTMLElement {
  const shell = container.querySelector<HTMLElement>(
    `[data-timeline-item][data-item-id="${ITEM_ID}"]`,
  )
  if (!shell) throw new Error('timeline item shell not rendered')
  return shell
}

// The video fade handles are one of the layers `DetailOnlyLayers` owns.
const DETAIL_LAYER_SELECTOR = '[data-clip-fade-controls="video"]'

describe('TimelineItem shells', () => {
  beforeEach(() => {
    setTimelineState({
      items: [VIDEO_ITEM],
      tracks: [makeTimelineTrack({ id: TRACK_ID, name: 'V1', kind: 'video', order: 0 })],
      fps: 30,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: false,
    })
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setActiveTool('select')
    useSelectionStore.getState().setDragState(null)
    dragOffsetRef.current = { x: 0, y: 0 }
    dragPreviewOffsetByItemRef.current = {}
  })

  it('renders the detail-only layers at full width', () => {
    const view = render(<TimelineItem item={VIDEO_ITEM} isCompactWidth={false} isDetailEligible />)

    const shell = getShell(view.container)
    expect(shell).not.toHaveAttribute('data-compact-clip')
    expect(view.container.querySelector(DETAIL_LAYER_SELECTOR)).not.toBeNull()
    expect(screen.getByText('clip.mp4')).toBeInTheDocument()
  })

  it('suppresses the detail-only layers at compact width while the clip still renders', () => {
    const view = render(<TimelineItem item={VIDEO_ITEM} isCompactWidth isDetailEligible={false} />)

    const shell = getShell(view.container)
    expect(shell).toHaveAttribute('data-compact-clip', 'true')
    // The positioned clip box survives the compact shell.
    expect(shell).toHaveAttribute('data-timeline-start-frame', '0')
    expect(shell).toHaveAttribute('data-timeline-duration-frames', '60')
    // ...but the rich layers inside it are skipped outright, not hidden.
    expect(view.container.querySelector(DETAIL_LAYER_SELECTOR)).toBeNull()
    expect(screen.queryByText('clip.mp4')).toBeNull()
  })

  it('reports selection on the shell', () => {
    const view = render(<TimelineItem item={VIDEO_ITEM} isCompactWidth={false} isDetailEligible />)
    const shell = getShell(view.container)
    expect(shell).not.toHaveAttribute('data-selected')

    act(() => {
      useSelectionStore.getState().selectItems([ITEM_ID])
    })

    expect(getShell(view.container)).toHaveAttribute('data-selected', 'true')
  })

  it('translates a dragged follower clip by the shared drag offset', () => {
    act(() => {
      useSelectionStore.getState().setDragState({
        isDragging: true,
        draggedItemIds: [ITEM_ID],
        offset: { x: 12, y: -4 },
        isAltDrag: false,
      })
    })
    dragOffsetRef.current = { x: 12, y: -4 }

    const view = render(<TimelineItem item={VIDEO_ITEM} isCompactWidth={false} isDetailEligible />)

    const shell = getShell(view.container)
    expect(shell.style.transform).toBe('translate(12px, -4px)')
    expect(shell.style.pointerEvents).toBe('none')
  })
})
