import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/editor/deps/timeline-test-helpers-contract'
import {
  openComposition,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-motion'
import { useEditorStore } from '@/shared/state/editor'
import type { TimelineItem } from '@/types/timeline'
import { useComposeUiStore } from './compose-ui-store'
import { MotionPreviewArea, MotionTimelineDock } from './compose-layout'

vi.mock('../preview-area', () => ({
  PreviewArea: ({
    project,
    durationInFrames,
    preferProjectStoreMetadata,
  }: {
    project: { width: number; height: number; fps: number; backgroundColor?: string }
    durationInFrames?: number
    preferProjectStoreMetadata?: boolean
  }) => (
    <div
      data-testid="preview-area"
      data-background-color={project.backgroundColor}
      data-duration-in-frames={durationInFrames}
      data-prefer-project-store-metadata={String(preferProjectStoreMetadata)}
    >
      {project.width}x{project.height}@{project.fps}
    </div>
  ),
}))

vi.mock('./compositing-timeline', () => ({
  CompositingTimeline: () => <div data-testid="compositing-timeline" />,
}))

vi.mock('./new-composition-dialog', () => ({
  NewCompositionDialog: ({ open }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="new-composition-dialog" /> : null,
}))

function addMotionComposition(id: string, name: string, width = 1920, items: TimelineItem[] = []) {
  useCompositionsStore.getState().addComposition({
    id,
    name,
    editorKind: 'composite-2d',
    items,
    tracks: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: '#123456',
  })
}

describe('Motion workspace composition session', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    setDefaultRootTimelineTracks()
    useComposeUiStore.setState({
      expandedLayerIdsByComposition: {},
      lastOpenedCompositionId: null,
      motionReturnTabCaptured: false,
      motionReturnTabId: null,
    })
    useEditorStore.getState().setWorkspace('edit')
    useTimelineSettingsStore.getState().setTimelineLoading(false)
  })

  afterEach(() => {
    cleanup()
    resetTimelineCompositionTestState()
  })

  it('shows a dedicated empty canvas instead of the Edit preview', () => {
    render(<MotionPreviewArea project={{ width: 1280, height: 720, fps: 30 }} />)

    expect(screen.getByTestId('motion-preview-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-area')).not.toBeInTheDocument()
  })

  it('renders only the active Motion composition in the preview', () => {
    addMotionComposition('motion-a', 'Lower third', 1440)
    useCompositionNavigationStore.getState().switchToSequence('motion-a')

    render(<MotionPreviewArea project={{ width: 1280, height: 720, fps: 24 }} />)

    expect(screen.getByTestId('preview-area')).toHaveTextContent('1440x1080@30')
    expect(screen.getByTestId('preview-area')).toHaveAttribute('data-background-color', '#123456')
    expect(screen.getByTestId('preview-area')).toHaveAttribute('data-duration-in-frames', '300')
    expect(screen.getByTestId('preview-area')).toHaveAttribute(
      'data-prefer-project-store-metadata',
      'false',
    )
    expect(screen.queryByTestId('motion-preview-empty')).not.toBeInTheDocument()
  })

  it('does not mount Motion surfaces until the isolated timeline holder exists', () => {
    const editorialItem = {
      id: 'main-item',
      type: 'video',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 120,
      label: 'Main timeline clip',
      mediaId: 'main-media',
      src: 'blob:main',
    } as TimelineItem
    useItemsStore.getState().setItems([editorialItem])
    addMotionComposition('motion-a', 'Motion composition')
    useCompositionNavigationStore.setState({
      breadcrumbs: [{ compositionId: 'motion-a', label: 'Motion composition' }],
      activeCompositionId: 'motion-a',
      stashStack: [],
      mainHolder: null,
    })

    render(
      <>
        <MotionPreviewArea project={{ width: 1280, height: 720, fps: 30 }} />
        <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />
      </>,
    )

    expect(screen.getByTestId('motion-preview-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-area')).not.toBeInTheDocument()
    expect(screen.getByTestId('motion-timeline-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('compositing-timeline')).not.toBeInTheDocument()
  })

  it('reopens the last Motion composition and restores Edit when leaving', async () => {
    addMotionComposition('motion-a', 'First')
    addMotionComposition('motion-b', 'Last used')
    useComposeUiStore.getState().setLastOpenedCompositionId('motion-b')
    useEditorStore.getState().setWorkspace('motion')

    const view = render(<MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />)

    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-b'),
    )
    expect(useComposeUiStore.getState().lastOpenedCompositionId).toBe('motion-b')

    useEditorStore.getState().setWorkspace('edit')
    view.unmount()
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
  })

  it('does not mount or open Motion against Main while an F5 hydration is in progress', async () => {
    const editorialItem = {
      id: 'main-item',
      type: 'video',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 120,
      label: 'Main timeline clip',
      mediaId: 'main-media',
      src: 'blob:main',
    } as TimelineItem
    addMotionComposition('motion-a', 'Motion composition')
    useComposeUiStore.getState().setLastOpenedCompositionId('motion-a')
    useTimelineSettingsStore.getState().setTimelineLoading(true)
    useEditorStore.getState().setWorkspace('motion')

    render(<MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />)

    // Simulate the async project loader hydrating Main after Motion mounted.
    useItemsStore.getState().setItems([editorialItem])
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(screen.getByTestId('motion-timeline-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('compositing-timeline')).not.toBeInTheDocument()

    useTimelineSettingsStore.getState().setTimelineLoading(false)

    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a'),
    )
    expect(screen.getByTestId('compositing-timeline')).toBeInTheDocument()
    expect(useItemsStore.getState().items).toEqual([])
    expect(useCompositionsStore.getState().compositionById['motion-a']?.items).toEqual([])
  })

  it('recovers an F5 session whose Motion id survived without its isolated timeline', async () => {
    const editorialItem = {
      id: 'main-item',
      type: 'video',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 120,
      label: 'Main timeline clip',
      mediaId: 'main-media',
      src: 'blob:main',
    } as TimelineItem
    const motionItem = {
      id: 'motion-item',
      type: 'shape',
      trackId: 'motion-track',
      from: 0,
      durationInFrames: 300,
      label: 'Motion layer',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      strokeWidth: 0,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    } as TimelineItem

    useItemsStore.getState().setItems([editorialItem])
    addMotionComposition('motion-a', 'Motion composition', 1920, [motionItem])
    useCompositionNavigationStore.setState({
      breadcrumbs: [{ compositionId: 'motion-a', label: 'Motion composition' }],
      activeCompositionId: 'motion-a',
      stashStack: [],
      mainHolder: null,
    })
    useComposeUiStore.getState().setLastOpenedCompositionId('motion-a')
    useEditorStore.getState().setWorkspace('motion')

    render(<MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />)

    await waitFor(() =>
      expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['motion-item']),
    )
    expect(useCompositionNavigationStore.getState().mainHolder?.items).toEqual([editorialItem])
    expect(screen.getByTestId('compositing-timeline')).toBeInTheDocument()
  })

  it('repairs a Motion composition that already absorbed Main timeline items', async () => {
    const editItem = {
      id: 'edit-item',
      type: 'video',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 1200,
      label: 'Editorial clip',
      mediaId: 'edit-media',
      src: 'blob:edit',
    } as TimelineItem
    const wrapper = {
      id: 'motion-wrapper',
      type: 'composition',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 300,
      sourceDuration: 300,
      label: 'Motion composition',
      compositionId: 'motion-a',
      compositionWidth: 1920,
      compositionHeight: 1080,
      transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    } as TimelineItem
    const motionItem = {
      id: 'motion-item',
      type: 'shape',
      trackId: 'motion-track',
      from: 0,
      durationInFrames: 300,
      label: 'Motion layer',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      strokeWidth: 0,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    } as TimelineItem
    useItemsStore.getState().setItems([editItem, wrapper])
    addMotionComposition('motion-a', 'Motion composition', 1920, [editItem, wrapper, motionItem])
    useCompositionsStore.getState().updateComposition('motion-a', {
      durationInFrames: 1200,
    })
    useEditorStore.getState().setWorkspace('motion')

    render(<MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />)

    await waitFor(() =>
      expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['motion-item']),
    )
    expect(
      useCompositionsStore.getState().compositionById['motion-a']?.items.map((item) => item.id),
    ).toEqual(['motion-item'])
    expect(useCompositionsStore.getState().compositionById['motion-a']?.durationInFrames).toBe(300)
  })

  it('routes an opened Motion composition out of Edit and into Motion', async () => {
    addMotionComposition('motion-a', 'Motion composition')

    openComposition('motion-a', 'Motion composition')

    expect(useEditorStore.getState().workspace).toBe('motion')
    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a'),
    )
  })

  it('keeps the original Edit return target when the Motion dock remounts', async () => {
    const editItem = {
      id: 'edit-item',
      type: 'video',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 60,
      label: 'Edit clip',
      mediaId: 'edit-media',
      src: 'blob:edit',
    } as TimelineItem
    const motionItem = {
      id: 'motion-item',
      type: 'shape',
      trackId: 'motion-track',
      from: 0,
      durationInFrames: 90,
      label: 'Motion layer',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      strokeWidth: 0,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    } as TimelineItem
    useItemsStore.getState().setItems([editItem])
    addMotionComposition('motion-a', 'Motion composition', 1920, [motionItem])
    useEditorStore.getState().setWorkspace('motion')

    const firstMount = render(
      <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />,
    )
    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a'),
    )
    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['motion-item'])

    firstMount.unmount()
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a')

    const secondMount = render(
      <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />,
    )
    useEditorStore.getState().setWorkspace('edit')

    // Restoration is synchronous with the workspace transition: the Edit
    // timeline can never render a frame backed by Motion's live layer stores.
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['edit-item'])
    expect(useComposeUiStore.getState().motionReturnTabCaptured).toBe(false)
    secondMount.unmount()
  })

  it('never captures an already-active Motion composition as an Edit return target', () => {
    addMotionComposition('motion-a', 'Persisted Motion composition')
    useCompositionNavigationStore.getState().switchToSequence('motion-a')
    useEditorStore.getState().setWorkspace('motion')

    const view = render(<MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />)
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a')

    useEditorStore.getState().setWorkspace('edit')

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(useCompositionNavigationStore.getState().breadcrumbs[0]?.compositionId).toBeNull()
    view.unmount()
  })
})
