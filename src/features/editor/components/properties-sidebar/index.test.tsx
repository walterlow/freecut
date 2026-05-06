import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/app/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { AudioItem, VideoItem } from '@/types/timeline'
import { PropertiesSidebar } from './index'

vi.mock('./canvas-panel', () => ({
  CanvasPanel: () => <div>Canvas Panel</div>,
}))

vi.mock('./clip-panel', () => ({
  ClipPanel: () => <div>Clip Panel</div>,
}))

vi.mock('./marker-panel', () => ({
  MarkerPanel: () => <div>Marker Panel</div>,
}))

vi.mock('./transition-panel', () => ({
  TransitionPanel: () => <div>Transition Panel</div>,
}))

const CLIP_A: VideoItem = {
  id: 'clip-a',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip-a.mp4',
  src: 'blob:clip-a',
  mediaId: 'media-a',
}

const CLIP_B: VideoItem = {
  id: 'clip-b',
  type: 'video',
  trackId: 'track-1',
  from: 90,
  durationInFrames: 90,
  label: 'clip-b.mp4',
  src: 'blob:clip-b',
  mediaId: 'media-b',
}

const CLIP_A_AUDIO: AudioItem = {
  id: 'clip-a-audio',
  type: 'audio',
  trackId: 'track-2',
  from: 0,
  durationInFrames: 90,
  label: 'clip-a.wav',
  src: 'blob:clip-a-audio',
  mediaId: 'media-a',
  linkedGroupId: 'linked-a',
}

const CLIP_A_VIDEO_LINKED: VideoItem = {
  ...CLIP_A,
  linkedGroupId: 'linked-a',
}

function resetStores(items: Array<VideoItem | AudioItem>, selectedItemIds: string[]) {
  useEditorStore.setState({
    rightSidebarOpen: true,
    rightSidebarWidth: 320,
  })

  useSelectionStore.setState({
    selectedItemIds,
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: selectedItemIds.length > 0 ? 'item' : null,
    dragState: null,
  })

  useItemsStore.getState().setItems(items)
}

describe('PropertiesSidebar', () => {
  beforeEach(() => {
    resetStores([CLIP_A], [CLIP_A.id])
  })

  it('shows the selected clip filename in the header', () => {
    render(<PropertiesSidebar />)

    expect(screen.getByText('clip-a.mp4')).toBeInTheDocument()
    expect(screen.getByText('Clip Panel')).toBeInTheDocument()
  })

  it('shows the first filename with a multi-select summary in the header', () => {
    resetStores([CLIP_A, CLIP_B], [CLIP_A.id, CLIP_B.id])

    render(<PropertiesSidebar />)

    expect(screen.getByText('2 clips selected')).toBeInTheDocument()
    expect(screen.getByTitle('clip-a.mp4, clip-b.mp4')).toBeInTheDocument()
  })

  it('treats a linked audio-video pair as one clip in the header', () => {
    resetStores([CLIP_A_VIDEO_LINKED, CLIP_A_AUDIO], [CLIP_A_VIDEO_LINKED.id, CLIP_A_AUDIO.id])

    render(<PropertiesSidebar />)

    expect(screen.getByText('clip-a.mp4')).toBeInTheDocument()
    expect(screen.queryByText('2 clips selected')).not.toBeInTheDocument()
    expect(screen.getByTitle('clip-a.mp4, clip-a.wav')).toBeInTheDocument()
  })

  it('hides the clip header when a transition selection takes priority', () => {
    resetStores([CLIP_A], [CLIP_A.id])
    useSelectionStore.setState({
      selectedTransitionId: 'transition-1',
      selectionType: 'transition',
    })

    render(<PropertiesSidebar />)

    expect(screen.getByText('Transition Panel')).toBeInTheDocument()
    expect(screen.queryByText('clip-a.mp4')).not.toBeInTheDocument()
  })

  it('hides the clip header when a marker selection takes priority', () => {
    resetStores([CLIP_A], [CLIP_A.id])
    useSelectionStore.setState({
      selectedMarkerId: 'marker-1',
      selectionType: 'marker',
    })

    render(<PropertiesSidebar />)

    expect(screen.getByText('Marker Panel')).toBeInTheDocument()
    expect(screen.queryByText('clip-a.mp4')).not.toBeInTheDocument()
  })
})
