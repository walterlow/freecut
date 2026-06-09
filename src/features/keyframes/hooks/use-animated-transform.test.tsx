import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useTimelineStore } from '@/features/keyframes/deps/timeline'
import { useAnimatedTransform, useAnimatedTransforms } from './use-animated-transform'
import type { TimelineItem } from '@/types/timeline'

const PROJECT_SIZE = { width: 1920, height: 1080 } as const

const ANIMATED_ITEM = {
  id: 'item-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 200,
  label: 'Test Item',
  text: 'Hello',
  color: '#ffffff',
  transform: {
    x: 0,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
  },
} as unknown as TimelineItem

const STATIC_ITEM = {
  id: 'item-2',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 200,
  label: 'Static Item',
  text: 'World',
  color: '#ffffff',
  transform: {
    x: 480,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
  },
} as unknown as TimelineItem

const WRAPPED_TEXT_ITEM = {
  ...STATIC_ITEM,
  id: 'item-3',
  text: 'line one\nline two\nline three\nline four',
  fontSize: 48,
  lineHeight: 1.2,
  transform: {
    ...STATIC_ITEM.transform,
    width: 200,
    height: 80,
  },
} as unknown as TimelineItem

const CORNER_PINNED_WRAPPED_TEXT_ITEM = {
  ...WRAPPED_TEXT_ITEM,
  id: 'item-4',
  cornerPin: {
    topLeft: [0, 0],
    topRight: [12, -8],
    bottomRight: [10, 14],
    bottomLeft: [-10, 6],
  },
} as unknown as TimelineItem

function SingleAnimatedTransformProbe() {
  const { transform, relativeFrame } = useAnimatedTransform(ANIMATED_ITEM, PROJECT_SIZE)
  return (
    <div
      data-testid="single-probe"
      data-x={String(transform.x)}
      data-relative-frame={String(relativeFrame)}
    />
  )
}

function MultiAnimatedTransformsProbe() {
  const transforms = useAnimatedTransforms([ANIMATED_ITEM], PROJECT_SIZE)
  const resolved = transforms.get(ANIMATED_ITEM.id)
  return <div data-testid="multi-probe" data-x={String(resolved?.x ?? Number.NaN)} />
}

function SwitchingItemProbe() {
  const [activeId, setActiveId] = useState<'animated' | 'static'>('animated')
  const activeItem = activeId === 'animated' ? ANIMATED_ITEM : STATIC_ITEM
  const { transform } = useAnimatedTransform(activeItem, PROJECT_SIZE)
  return (
    <>
      <button
        type="button"
        data-testid="switch-item"
        onClick={() => setActiveId(activeId === 'animated' ? 'static' : 'animated')}
      >
        Switch
      </button>
      <div data-testid="switch-probe" data-x={String(transform.x)} />
    </>
  )
}

function HeightProbe({ item }: { item: TimelineItem }) {
  const { transform } = useAnimatedTransform(item, PROJECT_SIZE)
  return <div data-testid="height-probe" data-height={String(transform.height)} />
}

function MultiHeightProbe({ item }: { item: TimelineItem }) {
  const transforms = useAnimatedTransforms([item], PROJECT_SIZE)
  const resolved = transforms.get(item.id)
  return <div data-testid="multi-height-probe" data-height={String(resolved?.height)} />
}

function resetStores() {
  localStorage.clear()

  resetPlaybackPreviewState(10)

  useTimelineStore.setState({
    keyframes: [
      {
        itemId: ANIMATED_ITEM.id,
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-10', frame: 10, value: 110, easing: 'linear' },
              { id: 'kf-20', frame: 20, value: 220, easing: 'linear' },
              { id: 'kf-30', frame: 30, value: 330, easing: 'linear' },
            ],
          },
        ],
      },
    ],
  })
}

describe('useAnimatedTransform skimming frame resolution', () => {
  beforeEach(() => {
    resetStores()
  })

  it('uses previewFrame while paused (single-item hook)', async () => {
    render(<SingleAnimatedTransformProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '110')
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '10')
    })

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20)
    })

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '220')
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '20')
    })
  })

  it('uses previewFrame while paused (multi-item hook)', async () => {
    render(<MultiAnimatedTransformsProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('multi-probe')).toHaveAttribute('data-x', '110')
    })

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20)
    })

    await waitFor(() => {
      expect(screen.getByTestId('multi-probe')).toHaveAttribute('data-x', '220')
    })
  })

  it('ignores previewFrame while playing', async () => {
    render(<SingleAnimatedTransformProbe />)

    act(() => {
      const playback = usePlaybackStore.getState()
      playback.setPreviewFrame(20)
      playback.play()
    })

    await waitFor(() => {
      // Playing mode follows currentFrame, not previewFrame.
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '110')
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '10')
    })
  })

  it('falls back to currentFrame when previewFrame is stale', async () => {
    render(<SingleAnimatedTransformProbe />)

    act(() => {
      const playback = usePlaybackStore.getState()
      playback.setPreviewFrame(20)
      playback.setCurrentFrame(30)
    })

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '330')
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '30')
    })
  })

  it('updates keyframe source when switching items without timeline changes', async () => {
    render(<SwitchingItemProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('switch-probe')).toHaveAttribute('data-x', '110')
    })

    fireEvent.click(screen.getByTestId('switch-item'))

    await waitFor(() => {
      expect(screen.getByTestId('switch-probe')).toHaveAttribute('data-x', '480')
    })
  })

  it('keeps corner-pinned text at its authored gizmo height', async () => {
    render(<HeightProbe item={CORNER_PINNED_WRAPPED_TEXT_ITEM} />)

    await waitFor(() => {
      expect(screen.getByTestId('height-probe')).toHaveAttribute('data-height', '80')
    })
  })

  it('still expands unpinned wrapped text to fit content', async () => {
    render(<HeightProbe item={WRAPPED_TEXT_ITEM} />)

    await waitFor(() => {
      expect(
        Number(screen.getByTestId('height-probe').getAttribute('data-height')),
      ).toBeGreaterThan(80)
    })
  })

  it('keeps batched corner-pinned text at its authored gizmo height', async () => {
    render(<MultiHeightProbe item={CORNER_PINNED_WRAPPED_TEXT_ITEM} />)

    await waitFor(() => {
      expect(screen.getByTestId('multi-height-probe')).toHaveAttribute('data-height', '80')
    })
  })
})
