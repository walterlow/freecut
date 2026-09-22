import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ShapeItem, TimelineItem, VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { setTimelineState } from '@/features/editor/deps/timeline-test-helpers-contract'
import { ShapeSection } from './shape-section'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const RECTANGLE: ShapeItem = {
  id: 'shape-rect',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'Rectangle',
  shapeType: 'rectangle',
  fillColor: '#3b82f6',
  fillEnabled: true,
  strokeColor: '#000000',
  strokeWidth: 4,
  strokeEnabled: true,
}

const SECOND_RECTANGLE: ShapeItem = {
  ...RECTANGLE,
  id: 'shape-rect-2',
  from: 90,
}

const VIDEO: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
}

function renderSection(items: TimelineItem[]) {
  return render(
    <TooltipProvider>
      <ShapeSection items={items} />
    </TooltipProvider>,
  )
}

/** The control a `PropertyRow` owns, addressed by its visible label. */
function controlFor(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement
  if (!row) throw new Error(`property row for ${label} not rendered`)
  return within(row).getByRole('button')
}

function committedItem(itemId: string): ShapeItem {
  const item = useItemsStore.getState().itemById[itemId]
  if (!item) throw new Error(`${itemId} missing from the items store`)
  return item as ShapeItem
}

describe('ShapeSection', () => {
  beforeEach(() => {
    setTimelineState({ items: [RECTANGLE, SECOND_RECTANGLE, VIDEO], fps: 30 })
  })

  it('renders the shape controls for a selected shape clip', () => {
    renderSection([RECTANGLE])

    expect(screen.getByText('editor.shapeSection.shape')).toBeInTheDocument()
    expect(controlFor('editor.shapeSection.fill')).toHaveTextContent('editor.shapeSection.on')
    expect(controlFor('editor.shapeSection.useAsMask')).toHaveTextContent('editor.shapeSection.off')
  })

  it('renders nothing when the selection holds no shape clips', () => {
    const view = renderSection([VIDEO])

    expect(view.container).toBeEmptyDOMElement()
  })

  it('commits a fill toggle to every selected shape', () => {
    renderSection([RECTANGLE, SECOND_RECTANGLE])

    fireEvent.click(controlFor('editor.shapeSection.fill'))

    expect(committedItem(RECTANGLE.id).fillEnabled).toBe(false)
    expect(committedItem(SECOND_RECTANGLE.id).fillEnabled).toBe(false)
  })

  it('commits a use-as-mask toggle with the mask defaults it implies', () => {
    renderSection([RECTANGLE])

    fireEvent.click(controlFor('editor.shapeSection.useAsMask'))

    expect(committedItem(RECTANGLE.id)).toMatchObject({
      isMask: true,
      maskType: 'clip',
      maskFeather: 0,
      maskOpacity: 100,
      maskInvert: false,
    })
  })
})
