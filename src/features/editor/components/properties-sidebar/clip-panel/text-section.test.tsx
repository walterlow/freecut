import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { CanvasSettings } from '@/types/transform'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { setTimelineState } from '@/features/editor/deps/timeline-test-helpers-contract'
import { TextContentSection, TextEffectsSection, TextStyleSection } from './text-section'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const CANVAS: CanvasSettings = { width: 1920, height: 1080, fps: 30 }

const TEXT: TextItem = {
  id: 'text-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'Text',
  text: 'Hello',
  color: '#ffffff',
}

const SECOND_TEXT: TextItem = { ...TEXT, id: 'text-2', from: 90 }

const SPAN_TEXT: TextItem = {
  ...TEXT,
  id: 'text-3',
  text: 'Eyebrow\nHeadline',
  textSpans: [{ text: 'Eyebrow' }, { text: 'Headline' }],
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

type Surface = 'content' | 'style' | 'effects'

const SURFACES = {
  content: TextContentSection,
  style: TextStyleSection,
  effects: TextEffectsSection,
} as const

function renderSection(items: TimelineItem[], surface: Surface = 'content') {
  const Section = SURFACES[surface]
  return render(
    <TooltipProvider>
      <Section items={items} canvas={CANVAS} />
    </TooltipProvider>,
  )
}

function committedItem(itemId: string): TextItem {
  const item = useItemsStore.getState().itemById[itemId]
  if (!item) throw new Error(`${itemId} missing from the items store`)
  return item as TextItem
}

function buttonFor(text: string): HTMLElement {
  const label = screen.getByText(text)
  const button = label.closest('button')
  if (!button) throw new Error(`no button for ${text}`)
  return button
}

describe('TextContentSection', () => {
  beforeEach(() => {
    setTimelineState({ items: [TEXT, SECOND_TEXT, SPAN_TEXT, VIDEO], fps: 30 })
  })

  it('renders the text layout controls for a selected text clip', () => {
    renderSection([TEXT])

    expect(screen.getByText('editor.textSection.sectionTitle')).toBeInTheDocument()
    expect(buttonFor('editor.textSection.single')).toBeInTheDocument()
    expect(buttonFor('editor.textSection.twoSpans')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('editor.textSection.enterText')).toBeInTheDocument()
  })

  it('renders nothing when the selection holds no text clips', () => {
    const view = renderSection([VIDEO])

    expect(view.container).toBeEmptyDOMElement()
  })

  it('commits an edited text to every selected text clip and relabels them', () => {
    renderSection([TEXT, SECOND_TEXT])

    fireEvent.change(screen.getByPlaceholderText('editor.textSection.enterText'), {
      target: { value: 'Rewritten' },
    })

    expect(committedItem(TEXT.id)).toMatchObject({ text: 'Rewritten', label: 'Rewritten' })
    expect(committedItem(SECOND_TEXT.id)).toMatchObject({ text: 'Rewritten', label: 'Rewritten' })
  })

  it('commits a bold toggle to every selected text clip', () => {
    renderSection([TEXT, SECOND_TEXT])

    fireEvent.click(screen.getByLabelText('editor.textSection.bold'))

    expect(committedItem(TEXT.id).fontWeight).toBe('bold')
    expect(committedItem(SECOND_TEXT.id).fontWeight).toBe('bold')
  })

  it('commits an alignment change to the selection', () => {
    renderSection([TEXT])

    fireEvent.click(screen.getByTitle('editor.textSection.alignLeft'))
    fireEvent.click(screen.getByTitle('editor.textSection.alignBottom'))

    expect(committedItem(TEXT.id)).toMatchObject({ textAlign: 'left', verticalAlign: 'bottom' })
  })

  it('drops the background when it is cleared', () => {
    setTimelineState({ items: [{ ...TEXT, backgroundColor: '#112233' }], fps: 30 })
    renderSection([{ ...TEXT, backgroundColor: '#112233' }])

    fireEvent.click(screen.getByTitle('editor.textSection.clearBackground'))

    expect(committedItem(TEXT.id).backgroundColor).toBeUndefined()
  })

  it('splits a plain clip into spans and commits the new layout', () => {
    renderSection([TEXT])

    fireEvent.click(buttonFor('editor.textSection.twoSpans'))

    const committed = committedItem(TEXT.id)
    expect(committed.textSpans).toHaveLength(2)
    expect(committed.textSpans?.map((span) => span.text)).toEqual(['Hello', 'Subtitle'])
  })

  it('edits one span of a structured clip without touching the others', () => {
    renderSection([SPAN_TEXT])

    fireEvent.change(screen.getByPlaceholderText('editor.textSection.titleText'), {
      target: { value: 'Edited' },
    })

    const spans = committedItem(SPAN_TEXT.id).textSpans ?? []
    expect(spans.map((span) => span.text)).toEqual(['Edited', 'Headline'])
  })

  it('shows the mixed placeholder when the selection disagrees on the text', () => {
    renderSection([TEXT, { ...SECOND_TEXT, text: 'Other' }])

    expect(screen.getByPlaceholderText('editor.textSection.mixed')).toBeInTheDocument()
  })
})

describe('TextStyleSection', () => {
  beforeEach(() => {
    setTimelineState({ items: [TEXT, SECOND_TEXT, VIDEO], fps: 30 })
  })

  it('commits an effect preset to every selected text clip', () => {
    renderSection([TEXT, SECOND_TEXT], 'style')

    fireEvent.click(buttonFor('editor.textSection.effectPresets.shadow'))

    expect(committedItem(TEXT.id).textShadow).toMatchObject({ offsetX: 4, offsetY: 6, blur: 12 })
    expect(committedItem(SECOND_TEXT.id).textShadow).toMatchObject({ blur: 12 })
  })

  it('keeps the effect presets off the content-only surface', () => {
    renderSection([TEXT])

    expect(screen.queryByText('editor.textSection.effectPresets.shadow')).not.toBeInTheDocument()
  })

  it('pairs the style controls with the animation slots for mixed selections', () => {
    renderSection([TEXT, VIDEO], 'effects')

    expect(screen.getByText('textMotion.sectionTitle')).toBeInTheDocument()
    expect(buttonFor('editor.textSection.effectPresets.glow')).toBeInTheDocument()
  })
})
