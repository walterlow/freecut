import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render, screen, fireEvent } from '@testing-library/react'
import { Projection360Section } from './projection-360-section'
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

vi.mock('@/features/editor/deps/timeline-store', () => ({
  useTimelineStore: createStoreHook(timelineState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

describe('Projection360Section', () => {
  const mockVideoItem: VideoItem = {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: '360_drone_video.mp4',
    src: 'blob:video',
    projection360: {
      enabled: true,
      preset: 'linear',
      fov: 78,
      distance: 1.0,
      distortion: 0.0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      horizonLock: 'off',
      horizonOffset: 0,
    },
  }

  beforeEach(() => {
    timelineState.updateItem.mockClear()
  })

  it('renders all 7 preset buttons', () => {
    render(<Projection360Section items={[mockVideoItem]} />)

    expect(screen.getByText('UltraWide')).toBeInTheDocument()
    expect(screen.getByText('Wide')).toBeInTheDocument()
    expect(screen.getByText('Linear')).toBeInTheDocument()
    expect(screen.getByText('Narrow')).toBeInTheDocument()
    expect(screen.getByText('45° Horizont')).toBeInTheDocument()
    expect(screen.getByText('360° Horizont')).toBeInTheDocument()
    expect(screen.getByText('Modo Libre (Sliders)')).toBeInTheDocument()
  })

  it('updates item with UltraWide preset when clicked', () => {
    render(<Projection360Section items={[mockVideoItem]} />)

    const ultraWideBtn = screen.getByText('UltraWide').closest('button')
    expect(ultraWideBtn).toBeInTheDocument()
    fireEvent.click(ultraWideBtn!)

    expect(timelineState.updateItem).toHaveBeenCalledWith('item-1', {
      projection360: expect.objectContaining({
        preset: 'ultra-wide',
        fov: 110,
        distortion: 0.0,
      }),
    })
  })

  it('updates item with 360° Horizont preset when clicked', () => {
    render(<Projection360Section items={[mockVideoItem]} />)

    const horizon360Btn = screen.getByText('360° Horizont').closest('button')
    expect(horizon360Btn).toBeInTheDocument()
    fireEvent.click(horizon360Btn!)

    expect(timelineState.updateItem).toHaveBeenCalledWith('item-1', {
      projection360: expect.objectContaining({
        preset: 'horizon-360',
        horizonLock: '360',
      }),
    })
  })

  it('centers camera orientation when Centrar Vista is clicked', () => {
    const tiltedItem: VideoItem = {
      ...mockVideoItem,
      projection360: {
        ...mockVideoItem.projection360!,
        yaw: 45,
        pitch: -30,
        roll: 15,
        horizonOffset: 5,
      },
    }

    render(<Projection360Section items={[tiltedItem]} />)

    const centerBtn = screen.getByText('Centrar Vista')
    fireEvent.click(centerBtn)

    expect(timelineState.updateItem).toHaveBeenCalledWith('item-1', {
      projection360: expect.objectContaining({
        yaw: 0,
        pitch: 0,
        roll: 0,
        horizonOffset: 0,
      }),
    })
  })
})
