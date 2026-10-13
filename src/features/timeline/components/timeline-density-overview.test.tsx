import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem } from '@/types/timeline'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { TimelineDensityOverview } from './timeline-density-overview'

const overviewItems: TimelineItem[] = [
  {
    id: 'overview-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'One',
    mediaId: 'media-1',
    src: 'blob:one',
  },
  {
    id: 'overview-2',
    type: 'video',
    trackId: 'track-1',
    from: 30,
    durationInFrames: 30,
    label: 'Two',
    mediaId: 'media-2',
    src: 'blob:two',
  },
]

describe('TimelineDensityOverview', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectItems([])
    useSelectionStore.getState().setActiveTool('select')
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useLinkedEditPreviewStore.getState().clear()
    vi.stubGlobal('requestAnimationFrame', () => 1)
  })

  it('resolves a bucket press back to an editable clip selection', () => {
    const view = render(
      <TimelineDensityOverview
        items={overviewItems}
        selectedItemIds={new Set()}
        trackLocked={false}
        trackHidden={false}
      />,
    )
    const bucket = view.container.querySelector('[data-timeline-density-bucket]')
    expect(bucket).not.toBeNull()

    fireEvent.mouseDown(bucket!, { button: 0, clientX: 0, clientY: 10 })
    fireEvent.mouseUp(bucket!, { button: 0, clientX: 0, clientY: 10 })
    fireEvent.click(bucket!, { button: 0, clientX: 0, clientY: 10 })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['overview-1'])
  })

  it('uses the same percentage geometry channel as native timeline items', () => {
    const view = render(
      <TimelineDensityOverview
        items={overviewItems}
        selectedItemIds={new Set()}
        trackLocked={false}
        trackHidden={false}
      />,
    )
    const buckets = view.container.querySelectorAll<HTMLElement>('[data-timeline-density-bucket]')

    expect(buckets[0]?.style.left).toContain('--timeline-percent-per-frame')
    expect(buckets[0]?.style.width).toContain('--timeline-percent-per-frame')
  })

  it('culls density shells to linked edit preview geometry', () => {
    useLinkedEditPreviewStore.getState().setUpdates([{ id: 'overview-1', durationInFrames: 12 }])

    const view = render(
      <TimelineDensityOverview
        items={overviewItems}
        selectedItemIds={new Set(['overview-1'])}
        trackLocked={false}
        trackHidden={false}
      />,
    )
    const bucket = view.container.querySelector<HTMLElement>('[data-timeline-density-bucket]')

    expect(bucket?.style.width).toBe('calc(12 * var(--timeline-percent-per-frame, 0%))')
    expect(bucket?.className).toContain('ring-primary')
  })

  it('replays a razor click onto the promoted native clip', () => {
    useSelectionStore.getState().setActiveTool('razor')
    const nativeClick = vi.fn()
    const view = render(
      <>
        <TimelineDensityOverview
          items={overviewItems}
          selectedItemIds={new Set()}
          trackLocked={false}
          trackHidden={false}
        />
        <div data-timeline-item data-item-id="overview-1" onClick={nativeClick} />
      </>,
    )
    const bucket = view.container.querySelector('[data-timeline-density-bucket]')!

    fireEvent.mouseDown(bucket, { button: 0, clientX: 0, clientY: 10 })
    fireEvent.mouseUp(bucket, { button: 0, clientX: 0, clientY: 10 })
    fireEvent.click(bucket, { button: 0, clientX: 0, clientY: 10 })

    expect(nativeClick).toHaveBeenCalledOnce()
  })
})
