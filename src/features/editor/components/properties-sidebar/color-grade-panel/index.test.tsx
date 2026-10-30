import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { ColorGradePanel } from './index'

const { VIDEO_ITEM } = vi.hoisted(() => ({
  VIDEO_ITEM: {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'clip.mp4',
    src: 'blob:clip',
    mediaId: 'media-1',
  } satisfies VideoItem,
}))

vi.mock('@/features/editor/deps/timeline-store', () => ({
  useItemsStore: (selector: (state: { itemById: Record<string, VideoItem> }) => unknown) =>
    selector({ itemById: { [VIDEO_ITEM.id]: VIDEO_ITEM } }),
}))

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: (selector: (state: { selectedItemIds: string[] }) => unknown) =>
    selector({ selectedItemIds: [VIDEO_ITEM.id] }),
}))

vi.mock('@/features/editor/deps/effects-contract', () => ({
  ColorGradeSection: ({
    layout,
    onCreateAdjustmentLayer,
  }: {
    layout?: string
    onCreateAdjustmentLayer?: () => void
  }) => (
    <div data-testid="color-grade-section" data-layout={layout}>
      {onCreateAdjustmentLayer ? 'has adjustment action' : null}
    </div>
  ),
  EffectsSection: ({ layout }: { layout?: string }) => (
    <div data-testid="effects-section" data-layout={layout}>
      Add Effect
    </div>
  ),
}))

vi.mock('@/features/editor/deps/timeline-keyframe-ui', () => ({
  KeyframeGraphPanel: ({
    isOpen,
    placement,
    showCloseButton,
    initialVisibleGroupIds,
    propertyColumnWidth,
  }: {
    isOpen: boolean
    placement?: string
    showCloseButton?: boolean
    initialVisibleGroupIds?: readonly string[]
    propertyColumnWidth?: number
  }) => (
    <div
      data-testid="keyframe-graph-panel"
      data-open={String(isOpen)}
      data-placement={placement}
      data-show-close={String(showCloseButton)}
      data-initial-groups={initialVisibleGroupIds?.join(',')}
      data-property-column-width={propertyColumnWidth}
    />
  ),
}))

describe('ColorGradePanel', () => {
  it('keeps the original graph lane with Effects as its default parameter filter', async () => {
    render(<ColorGradePanel layout="dock" />)

    const gradeSection = await screen.findByTestId('color-grade-section', {}, { timeout: 5000 })
    expect(gradeSection).toHaveAttribute('data-layout', 'dock')
    expect(gradeSection).toHaveTextContent('has adjustment action')
    expect(screen.getByText('Add Effect')).toBeInTheDocument()

    expect(screen.getByTestId('color-keyframes-lane')).toBeInTheDocument()
    const keyframePanel = screen.getByTestId('keyframe-graph-panel')
    expect(keyframePanel).toHaveAttribute('data-open', 'true')
    expect(keyframePanel).toHaveAttribute('data-placement', 'side')
    expect(keyframePanel).toHaveAttribute('data-show-close', 'false')
    expect(keyframePanel).toHaveAttribute('data-initial-groups', 'effects')
    expect(keyframePanel).toHaveAttribute('data-property-column-width', '336')
  })

  it('stacks the dock panes so the graph keeps its full width beside the preview', async () => {
    render(<ColorGradePanel layout="dock" stacked />)

    await screen.findByTestId('color-grade-section', {}, { timeout: 5000 })
    const lane = screen.getByTestId('color-keyframes-lane')
    expect(lane.parentElement).toHaveAttribute('data-stacked', 'true')
    expect(lane.parentElement?.className).toContain('grid-cols-1')
  })

  it('keeps the sidebar variant stacked without the dock graph lane', async () => {
    render(<ColorGradePanel />)

    await waitFor(() => expect(screen.getByTestId('color-grade-section')).toBeInTheDocument(), {
      timeout: 5000,
    })
    expect(screen.queryByTestId('color-keyframes-lane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('keyframe-graph-panel')).not.toBeInTheDocument()
  })
})
