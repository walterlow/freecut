import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { transitionRegistry } from '@/core/timeline/transitions'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { Transition } from '@/types/transition'
import type { VideoItem } from '@/types/timeline'
import type { TransitionRenderer } from '@/core/timeline/transitions/registry'
import { TransitionPanel } from './index'

vi.mock('../components', () => ({
  PropertySection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  PropertyRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
  SliderInput: () => <div data-testid="slider-input" />,
}))

const LEFT_CLIP: VideoItem = {
  id: 'left',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  sourceStart: 10,
  sourceEnd: 100,
  sourceDuration: 180,
  label: 'left.mp4',
  src: 'blob:left',
  mediaId: 'media-left',
}

const RIGHT_CLIP: VideoItem = {
  id: 'right',
  type: 'video',
  trackId: 'track-1',
  from: 90,
  durationInFrames: 90,
  sourceStart: 60,
  sourceEnd: 150,
  sourceDuration: 240,
  label: 'right.mp4',
  src: 'blob:right',
  mediaId: 'media-right',
}

const TRANSITION: Transition = {
  id: 'tr-1',
  type: 'crossfade',
  presentation: 'wipe',
  direction: 'from-left',
  timing: 'linear',
  leftClipId: LEFT_CLIP.id,
  rightClipId: RIGHT_CLIP.id,
  trackId: 'track-1',
  durationInFrames: 30,
}

const LINEAR_ONLY_PRESENTATION_ID = 'test-linear-only-transition'

const NO_EASE_RENDERER: TransitionRenderer = {
  calculateStyles: () => ({ opacity: 1 }),
}

describe('TransitionPanel', () => {
  beforeAll(() => {
    transitionRegistry.register(
      LINEAR_ONLY_PRESENTATION_ID,
      {
        id: LINEAR_ONLY_PRESENTATION_ID,
        label: 'Linear Only',
        description: 'Test transition with only linear timing',
        category: 'custom',
        icon: 'Blend',
        hasDirection: false,
        supportedTimings: ['linear'],
        defaultDuration: 30,
        minDuration: 1,
        maxDuration: 60,
      },
      NO_EASE_RENDERER,
    )
  })

  afterAll(() => {
    transitionRegistry.unregister(LINEAR_ONLY_PRESENTATION_ID)
  })

  beforeEach(() => {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = () => {}
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }

    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: TRANSITION.id,
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: 'transition',
      dragState: null,
    })

    useTimelineStore.setState({
      fps: 30,
      items: [LEFT_CLIP, RIGHT_CLIP],
      transitions: [TRANSITION],
    } as Partial<ReturnType<typeof useTimelineStore.getState>>)
  })

  it('shows transition presets and exposes direction as a property', () => {
    render(<TransitionPanel />)

    expect(screen.getByRole('combobox')).toHaveTextContent('Slide')
    expect(screen.getByText('Preset')).toBeInTheDocument()
    expect(screen.getByText('Direction')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Left' })).toHaveClass('bg-background')
  })

  it('filters transition presets from the dropdown search box', () => {
    render(<TransitionPanel />)

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('searchbox', { name: 'Search transitions' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transitions' }), {
      target: { value: 'jump-cut' },
    })

    expect(screen.getByText('Smooth Cut')).toBeInTheDocument()
    expect(screen.queryByText('Cross Dissolve')).not.toBeInTheDocument()
  })

  it('shows an empty state when transition preset search has no matches', () => {
    render(<TransitionPanel />)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transitions' }), {
      target: { value: 'nope-nope-nope' },
    })

    expect(screen.getByText('No transitions found')).toBeInTheDocument()
  })

  it('shows ease options and updates the selected ease curve', async () => {
    render(<TransitionPanel />)

    expect(screen.getByText('Ease')).toBeInTheDocument()
    expect(screen.getByText('Linear').closest('button')).toHaveClass('bg-background')

    fireEvent.click(screen.getByText('Out').closest('button')!)

    await waitFor(() => {
      expect(
        useTimelineStore.getState().transitions.find((transition) => transition.id === 'tr-1')
          ?.timing,
      ).toBe('ease-out')
    })
  })

  it('shows only supported ease options for the selected transition', () => {
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: 'tr-linear-only',
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: 'transition',
      dragState: null,
    })

    useTimelineStore.setState({
      fps: 30,
      items: [LEFT_CLIP, RIGHT_CLIP],
      transitions: [
        {
          ...TRANSITION,
          id: 'tr-linear-only',
          presentation: LINEAR_ONLY_PRESENTATION_ID,
          timing: 'linear',
        },
      ],
    } as Partial<ReturnType<typeof useTimelineStore.getState>>)

    render(<TransitionPanel />)

    expect(screen.getByText('Ease')).toBeInTheDocument()
    expect(screen.getByText('Linear').closest('button')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'In & Out' })).not.toBeInTheDocument()
  })

  it('updates direction from the direction property controls', async () => {
    render(<TransitionPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Right' }))

    await waitFor(() => {
      expect(
        useTimelineStore.getState().transitions.find((transition) => transition.id === 'tr-1')
          ?.direction,
      ).toBe('from-right')
    })
  })

  it('exposes a color property for dip to color dissolve', async () => {
    useTimelineStore.setState({
      fps: 30,
      items: [LEFT_CLIP, RIGHT_CLIP],
      transitions: [
        {
          ...TRANSITION,
          presentation: 'dipToColorDissolve',
          properties: { color: [1, 0, 0] },
        },
      ],
    } as Partial<ReturnType<typeof useTimelineStore.getState>>)

    render(<TransitionPanel />)

    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dip color' })).toBeInTheDocument()
    expect(screen.getByText('#ff0000')).toBeInTheDocument()
  })
})
