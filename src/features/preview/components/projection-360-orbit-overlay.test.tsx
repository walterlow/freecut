import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render, screen, fireEvent } from '@testing-library/react'
import { Projection360OrbitOverlay } from './projection-360-orbit-overlay'
import type { VideoItem } from '@/types/timeline'

const timelineState = vi.hoisted(() => ({
  updateItem: vi.fn(),
}))

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState
  }
  hook.getState = () => state
  return hook
}

vi.mock('@/features/preview/deps/timeline-store', () => ({
  useTimelineStore: createStoreHook(timelineState),
}))

describe('Projection360OrbitOverlay', () => {
  const mockItem: VideoItem = {
    id: 'video-360',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 300,
    label: 'insta_x3_pano.insv',
    src: 'blob:video',
    projection360: {
      enabled: true,
      preset: 'linear',
      fov: 78,
      distance: 1.0,
      distortion: 0.0,
      yaw: 10,
      pitch: 5,
      roll: 0,
      horizonLock: 'off',
      horizonOffset: 0,
    },
  }

  beforeEach(() => {
    timelineState.updateItem.mockClear()
  })

  it('renders the 360° Orbit HUD badge with current angles', () => {
    render(<Projection360OrbitOverlay item={mockItem} containerRect={null} />)

    expect(screen.getByText('360° Orbit')).toBeInTheDocument()
    expect(screen.getByText('Yaw: 10°')).toBeInTheDocument()
    expect(screen.getByText('Pitch: 5°')).toBeInTheDocument()
    expect(screen.getByText('FOV: 78°')).toBeInTheDocument()
  })

  it('updates FOV on mouse wheel', () => {
    const { container } = render(<Projection360OrbitOverlay item={mockItem} containerRect={null} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.wheel(overlay, { deltaY: 100 })

    expect(timelineState.updateItem).toHaveBeenCalledWith(
      'video-360',
      expect.objectContaining({
        projection360: expect.objectContaining({
          fov: 83, // 78 + 100 * 0.05 = 83
          preset: 'custom',
        }),
      }),
    )
  })

  it('resets orientation to 0 on double click', () => {
    const { container } = render(<Projection360OrbitOverlay item={mockItem} containerRect={null} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.doubleClick(overlay)

    expect(timelineState.updateItem).toHaveBeenCalledWith(
      'video-360',
      expect.objectContaining({
        projection360: expect.objectContaining({
          yaw: 0,
          pitch: 0,
          roll: 0,
        }),
      }),
    )
  })
})
