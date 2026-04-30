import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import type { VideoItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store'
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store'
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store'
import { useTransitionBreakPreviewStore } from '../stores/transition-break-preview-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { TransitionItem } from './transition-item'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

describe('TransitionItem preview bridge motion', () => {
  const transition: Transition = {
    id: 'tr-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-1',
    durationInFrames: 20,
  }

  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useZoomStore.getState().setZoomLevelImmediate(1)
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useSelectionStore.setState({ selectedTransitionId: null, dragState: null })
    useRollingEditPreviewStore.getState().clearPreview()
    useSlideEditPreviewStore.getState().clearPreview()
    useRippleEditPreviewStore.getState().clearPreview()
    useTransitionBreakPreviewStore.getState().clearPreview()
    useLinkedEditPreviewStore.getState().clear()
    useTransitionDragStore.getState().clearDrag()
  })

  it('updates bridge position in realtime while slide preview delta changes', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    render(<TransitionItem transition={transition} />)

    const overlay = screen.getByTitle('Fade (0.7s)')
    const initialLeftPx = parseFloat(overlay.style.left)

    act(() => {
      useSlideEditPreviewStore.getState().setPreview({
        itemId: 'left',
        trackId: 'track-1',
        leftNeighborId: null,
        rightNeighborId: null,
        slideDelta: 9,
      })
    })

    const updatedLeftPx = parseFloat(screen.getByTitle('Fade (0.7s)').style.left)
    expect(updatedLeftPx - initialLeftPx).toBe(30)
  })

  it('updates bridge position in realtime while rolling preview delta changes', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    render(<TransitionItem transition={transition} />)

    const overlay = screen.getByTitle('Fade (0.7s)')
    const initialLeftPx = parseFloat(overlay.style.left)

    act(() => {
      useRollingEditPreviewStore.getState().setPreview({
        trimmedItemId: 'right',
        neighborItemId: 'left',
        handle: 'start',
        neighborDelta: -6,
      })
    })

    const updatedLeftPx = parseFloat(screen.getByTitle('Fade (0.7s)').style.left)
    expect(updatedLeftPx - initialLeftPx).toBe(-20)
  })

  it('keeps the bridge inside the full clip body below the title bar', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    render(<TransitionItem transition={transition} />)

    const overlay = screen.getByTitle('Fade (0.7s)')
    expect(overlay.className).toContain('inset-y-0')
    expect(overlay.style.top).toBe('calc(var(--editor-timeline-clip-label-row-height) + 1px)')
    expect(overlay.style.bottom).toBe('1px')
  })

  it('keeps a minimum-width bridge inside the previewed right clip during slide on a speed-adjusted segment', () => {
    const slideTransition: Transition = {
      ...transition,
      durationInFrames: 4,
      leftClipId: 'middle',
      rightClipId: 'right',
    }
    const middle = makeVideoItem({ id: 'middle', from: 100, durationInFrames: 60, speed: 1.23 })
    const right = makeVideoItem({
      id: 'right',
      from: 160,
      durationInFrames: 12,
      mediaId: 'media-2',
      speed: 1.23,
    })
    useItemsStore.getState().setItems([middle, right])

    render(<TransitionItem transition={slideTransition} />)

    act(() => {
      useSlideEditPreviewStore.getState().setPreview({
        itemId: 'middle',
        trackId: 'track-1',
        leftNeighborId: null,
        rightNeighborId: 'right',
        slideDelta: 8,
      })
    })

    const overlay = screen.getByTitle('Fade (0.1s)')
    const rightEdge = parseFloat(overlay.style.left) + parseFloat(overlay.style.width)
    const previewedRightClipEnd = ((right.from + right.durationInFrames) / 30) * 100

    expect(rightEdge).toBeLessThanOrEqual(Math.round(previewedRightClipEnd))
  })

  it('selects the transition when an edge handle is clicked', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    const { container } = render(<TransitionItem transition={transition} />)
    const handle = container.querySelector('[data-transition-hit-zone="left-edge"]')
    expect(handle).not.toBeNull()

    fireEvent.mouseDown(handle!, { button: 0, clientX: 10 })
    fireEvent.mouseUp(document, { clientX: 10 })

    expect(useSelectionStore.getState().selectedTransitionId).toBe('tr-1')
  })

  it('keeps the existing bridge droppable when zoomed out to its compact minimum width', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 160,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])
    useZoomStore.getState().setZoomLevelImmediate(0.1)
    useTransitionDragStore
      .getState()
      .setDraggedTransition({ presentation: 'wipe', direction: 'from-left' })

    const { container } = render(
      <TransitionItem transition={{ ...transition, durationInFrames: 4 }} />,
    )

    const overlay = screen.getByTitle('Fade (0.1s)')
    expect(overlay.style.width).toBe('10px')

    const dropZone = container.querySelector('[data-transition-hit-zone="bridge-drop"]')
    expect(dropZone).not.toBeNull()

    fireEvent.dragOver(dropZone!, {
      dataTransfer: {
        dropEffect: 'none',
        getData: () => '',
      },
    })

    expect(useTransitionDragStore.getState().preview).toMatchObject({
      existingTransitionId: 'tr-1',
      leftClipId: 'left',
      rightClipId: 'right',
    })
  })

  it('leaves the cut-side edge non-draggable for an incoming-aligned transition', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 160,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    const { container } = render(<TransitionItem transition={{ ...transition, alignment: 0 }} />)

    expect(container.querySelector('[data-transition-hit-zone="left-edge"]')).toBeNull()
    expect(container.querySelector('[data-transition-hit-zone="right-edge"]')).not.toBeNull()
  })

  it('leaves the cut-side edge non-draggable for an outgoing-aligned transition', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 160,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    const { container } = render(<TransitionItem transition={{ ...transition, alignment: 1 }} />)

    expect(container.querySelector('[data-transition-hit-zone="left-edge"]')).not.toBeNull()
    expect(container.querySelector('[data-transition-hit-zone="right-edge"]')).toBeNull()
  })

  it('hides the bridge while previewing a trim that breaks the transition', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    render(<TransitionItem transition={transition} />)
    expect(screen.getByTitle('Fade (0.7s)')).toBeInTheDocument()

    act(() => {
      useTransitionBreakPreviewStore.getState().setPreview({
        itemId: 'left',
        handle: 'end',
        delta: -8,
      })
    })

    expect(screen.queryByTitle('Fade (0.7s)')).toBeNull()
  })

  it('hides the bridge when a linked preview temporarily hides either clip', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 })
    const right = makeVideoItem({
      id: 'right',
      from: 140,
      durationInFrames: 80,
      mediaId: 'media-2',
    })
    useItemsStore.getState().setItems([left, right])

    render(<TransitionItem transition={transition} />)
    expect(screen.getByTitle('Fade (0.7s)')).toBeInTheDocument()

    act(() => {
      useLinkedEditPreviewStore.getState().setUpdates([{ id: 'left', hidden: true }])
    })

    expect(screen.queryByTitle('Fade (0.7s)')).toBeNull()
  })
})
