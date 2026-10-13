import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PreviewArea } from './preview-area'
import { useMaskEditorStore, useItemsStore } from '@/features/editor/deps/preview'
import { useProjectStore } from '@/features/editor/deps/projects'
import { useEditorStore } from '@/shared/state/editor'

vi.mock('@/features/editor/deps/preview', async () => {
  const actual = await vi.importActual<typeof import('@/features/editor/deps/preview')>(
    '@/features/editor/deps/preview',
  )

  return {
    ...actual,
    VideoPreview: ({
      chrome,
      project,
    }: {
      chrome?: 'edit' | 'color'
      project: { width: number; height: number; fps: number; backgroundColor?: string }
    }) => (
      <div
        data-testid={chrome === 'color' ? 'color-video-preview' : 'video-preview'}
        data-width={project.width}
        data-height={project.height}
        data-fps={project.fps}
        data-background-color={project.backgroundColor}
      />
    ),
    ColorVideoPreview: () => <div data-testid="color-video-preview" />,
    AlignmentToolbar: () => <div data-testid="alignment-toolbar" />,
    PlaybackControls: ({ totalFrames }: { totalFrames: number }) => (
      <div data-testid="playback-controls" data-total-frames={totalFrames} />
    ),
    TimecodeDisplay: ({ totalFrames }: { totalFrames: number }) => (
      <div data-testid="timecode-display" data-total-frames={totalFrames} />
    ),
    PreviewZoomControls: () => <div data-testid="preview-zoom-controls" />,
    importSourceMonitor: vi.fn().mockResolvedValue({
      SourceMonitor: () => <div data-testid="source-monitor" />,
    }),
    importInlineSourcePreview: vi.fn().mockResolvedValue({
      InlineSourcePreview: () => <div data-testid="inline-source-preview" />,
    }),
    importInlineCompositionPreview: vi.fn().mockResolvedValue({
      InlineCompositionPreview: () => <div data-testid="inline-composition-preview" />,
    }),
    importColorScopesMonitor: vi.fn().mockResolvedValue({
      ColorScopesMonitor: () => <div data-testid="color-scopes-monitor" />,
    }),
  }
})

function resetStores() {
  useProjectStore.setState({ currentProject: null })
  useMaskEditorStore.getState().stopEditing()
  useItemsStore.getState().setItems([])
  useEditorStore.setState({
    linkedSelectionEnabled: true,
    sourcePreviewMediaId: null,
    mediaSkimPreviewMediaId: null,
    mediaSkimPreviewFrame: null,
    compoundClipSkimPreviewCompositionId: null,
    compoundClipSkimPreviewFrame: null,
    colorScopesOpen: false,
    workspace: 'edit',
  })
}

function renderPathEditingPreview() {
  useItemsStore.getState().setItems([
    {
      id: 'path-1',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Mask',
      shapeType: 'path',
      fillColor: '#ffffff',
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        rotation: 0,
        opacity: 1,
      },
    },
  ])
  useMaskEditorStore.getState().startEditing('path-1')

  render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)
}

describe('PreviewArea mask editor toolbar', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  beforeEach(() => {
    resetStores()
  })

  it('shows the edit HUD when path edit mode is active', () => {
    renderPathEditingPreview()

    expect(screen.getByText('Path Edit')).toBeInTheDocument()
    expect(screen.getByText('4 points')).toBeInTheDocument()
    expect(
      screen.getByText('Drag points, handles, or the path body to adjust the shape.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corner' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeDisabled()
    expect(screen.queryByText('Pen Tool')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(useMaskEditorStore.getState().isEditing).toBe(false)
  })

  it('does not show the color scopes panel in edit workspace', () => {
    useEditorStore.setState({
      colorScopesOpen: true,
      workspace: 'edit',
    })

    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(screen.queryByTestId('color-scopes-monitor')).not.toBeInTheDocument()
    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
  })

  it('locks preview side panels during path edit mode', async () => {
    useEditorStore.setState({
      sourcePreviewMediaId: 'media-1',
      colorScopesOpen: true,
      workspace: 'color',
    })
    useItemsStore.getState().setItems([
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: {
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
        },
      },
    ])
    useMaskEditorStore.getState().startEditing('path-1')

    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(
      (await screen.findByTestId('source-monitor')).closest('[data-interaction-locked="true"]'),
    ).toBeTruthy()
    expect(
      (await screen.findByTestId('color-scopes-monitor')).closest(
        '[data-interaction-locked="true"]',
      ),
    ).toBeTruthy()
  })

  it('shows the media skim preview in the program monitor while hover preview is active', async () => {
    useEditorStore.setState({
      mediaSkimPreviewMediaId: 'media-1',
      mediaSkimPreviewFrame: 24,
    })

    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(await screen.findByTestId('inline-source-preview')).toBeInTheDocument()
    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument()
  })

  it('uses full edit preview chrome outside color workspace', () => {
    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
    expect(screen.getByTestId('alignment-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('color-video-preview')).not.toBeInTheDocument()
  })

  it('uses provided composition metadata and authored duration when requested', () => {
    useProjectStore.setState({
      currentProject: {
        id: 'project-1',
        name: 'Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 0,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: '#000000',
        },
      },
    })
    useItemsStore.getState().setItems([
      {
        id: 'overhang-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 1800,
        label: 'Overhanging layer',
        shapeType: 'rectangle',
        fillColor: '#ffffff',
      },
    ])

    render(
      <PreviewArea
        project={{ width: 1440, height: 1080, fps: 24, backgroundColor: '#123456' }}
        durationInFrames={240}
        preferProjectStoreMetadata={false}
      />,
    )

    expect(screen.getByTestId('video-preview')).toHaveAttribute('data-width', '1440')
    expect(screen.getByTestId('video-preview')).toHaveAttribute('data-height', '1080')
    expect(screen.getByTestId('video-preview')).toHaveAttribute('data-fps', '24')
    expect(screen.getByTestId('video-preview')).toHaveAttribute('data-background-color', '#123456')
    expect(screen.getByTestId('playback-controls')).toHaveAttribute('data-total-frames', '240')
    expect(screen.getByTestId('timecode-display')).toHaveAttribute('data-total-frames', '240')
  })

  it('uses color preview chrome without the alignment toolbar in color workspace', () => {
    useEditorStore.setState({ workspace: 'color' })

    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(screen.getByTestId('color-video-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('alignment-toolbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument()
  })

  it('preserves the program preview DOM while switching workspace chrome', () => {
    const { rerender } = render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)
    const previewNode = screen.getByTestId('video-preview')

    act(() => {
      useEditorStore.setState({ workspace: 'color' })
    })
    rerender(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(screen.getByTestId('color-video-preview')).toBe(previewNode)
  })

  it('shows the compound clip skim preview in the program monitor while hover preview is active', async () => {
    useEditorStore.setState({
      compoundClipSkimPreviewCompositionId: 'composition-1',
      compoundClipSkimPreviewFrame: 42,
    })

    render(<PreviewArea project={{ width: 1920, height: 1080, fps: 30 }} />)

    expect(await screen.findByTestId('inline-composition-preview')).toBeInTheDocument()
    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument()
  })

  it('enables knot conversion buttons for a selected point and dispatches the request', () => {
    renderPathEditingPreview()

    act(() => {
      useMaskEditorStore.getState().selectVertex(1)
    })

    expect(screen.getByRole('button', { name: 'Corner' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Bezier' }))

    expect(useMaskEditorStore.getState().convertSelectedVertexRequestMode).toBe('bezier')
    expect(useMaskEditorStore.getState().convertSelectedVertexRequestVersion).toBe(1)
  })

  it('shows the selected point count for multi-selection', () => {
    renderPathEditingPreview()

    act(() => {
      useMaskEditorStore.getState().selectVertices([0, 1, 2, 3], 3)
    })

    expect(screen.getByRole('button', { name: 'Corner' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeEnabled()
    expect(screen.getByText('4 points selected for knot conversion.')).toBeInTheDocument()
  })
})
