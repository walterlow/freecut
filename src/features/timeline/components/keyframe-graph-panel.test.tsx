import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type * as ReactI18next from 'react-i18next'
import type { VideoItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { setTimelineState } from '../test-helpers'
import { KeyframeGraphPanel } from './keyframe-graph-panel'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

const MODE_STORAGE_KEY = 'timeline:keyframeEditorMode'

const VIDEO_ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: 'track-v1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
}

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  })
})

afterAll(() => {
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  }
})

function renderPanel({ isOpen = true, splitView = false } = {}) {
  return render(
    <KeyframeGraphPanel isOpen={isOpen} onClose={() => {}} splitView={splitView} />,
  )
}

describe('KeyframeGraphPanel surfaces', () => {
  beforeEach(() => {
    localStorage.removeItem(MODE_STORAGE_KEY)
    setTimelineState({ items: [VIDEO_ITEM], fps: 30 })
    useSelectionStore.getState().selectItems([VIDEO_ITEM.id])
  })

  it('renders no docked editor while closed', () => {
    const view = renderPanel({ isOpen: false })

    expect(view.container).toBeEmptyDOMElement()
  })

  it('renders the sheet surface for the selected clip in dopesheet mode', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'dopesheet')
    renderPanel()

    expect(screen.getByTestId('dopesheet-editor-root')).toBeInTheDocument()
    expect(screen.getByTestId('dopesheet-playhead-clip')).toBeInTheDocument()
    expect(screen.queryByTestId('dopesheet-graph-pane')).not.toBeInTheDocument()
  })

  it('swaps the sheet for the value graph when the graph tab is picked', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'dopesheet')
    renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: 'timeline.keyframeEditor.legend.graphMode' }))

    expect(screen.getByTestId('dopesheet-graph-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('dopesheet-playhead-clip')).not.toBeInTheDocument()
  })

  it('stacks the sheet and the graph in split mode', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'dopesheet')
    renderPanel({ splitView: true })

    fireEvent.click(screen.getByRole('tab', { name: 'timeline.keyframeEditor.split' }))

    expect(screen.getByTestId('dopesheet-playhead-clip')).toBeInTheDocument()
    expect(screen.getByTestId('dopesheet-graph-pane')).toBeInTheDocument()
    expect(screen.getAllByTestId('dopesheet-ruler')).toHaveLength(1)
  })
})
