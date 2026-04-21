import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreviewArea } from './preview-area';
import { useMaskEditorStore, useItemsStore } from '@/features/editor/deps/preview';
import { useEditorStore } from '@/app/state/editor';

vi.mock('@/features/editor/deps/preview', async () => {
  const actual = await vi.importActual<typeof import('@/features/editor/deps/preview')>(
    '@/features/editor/deps/preview'
  );

  return {
    ...actual,
    VideoPreview: () => <div data-testid="video-preview" />,
    PlaybackControls: () => <div data-testid="playback-controls" />,
    TimecodeDisplay: () => <div data-testid="timecode-display" />,
    PreviewZoomControls: () => <div data-testid="preview-zoom-controls" />,
    SourceMonitor: () => <div data-testid="source-monitor" />,
    InlineSourcePreview: () => <div data-testid="inline-source-preview" />,
    InlineCompositionPreview: () => <div data-testid="inline-composition-preview" />,
    ColorScopesMonitor: () => <div data-testid="color-scopes-monitor" />,
  };
});

function resetStores() {
  useMaskEditorStore.getState().stopEditing();
  useItemsStore.getState().setItems([]);
  useEditorStore.setState({
    linkedSelectionEnabled: true,
    sourcePreviewMediaId: null,
    mediaSkimPreviewMediaId: null,
    mediaSkimPreviewFrame: null,
    compoundClipSkimPreviewCompositionId: null,
    compoundClipSkimPreviewFrame: null,
    colorScopesOpen: false,
  });
}

describe('PreviewArea mask editor toolbar', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  beforeEach(() => {
    resetStores();
  });

  it('shows the edit HUD when path edit mode is active', () => {
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
    ]);
    useMaskEditorStore.getState().startEditing('path-1');

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    expect(screen.getByText('路径编辑')).toBeInTheDocument();
    expect(screen.getByText('4 个点')).toBeInTheDocument();
    expect(
      screen.getByText('拖动点、手柄或路径主体可调整形状。')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '角点' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '贝塞尔' })).toBeDisabled();
    expect(screen.queryByText('钢笔工具')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(useMaskEditorStore.getState().isEditing).toBe(false);
  });

  it('locks preview side panels during path edit mode', () => {
    useEditorStore.setState({
      sourcePreviewMediaId: 'media-1',
      colorScopesOpen: true,
    });
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
    ]);
    useMaskEditorStore.getState().startEditing('path-1');

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    expect(
      screen.getByTestId('source-monitor').closest('[data-interaction-locked="true"]')
    ).toBeTruthy();
    expect(
      screen.getByTestId('color-scopes-monitor').closest('[data-interaction-locked="true"]')
    ).toBeTruthy();
  });

  it('shows the media skim preview in the program monitor while hover preview is active', () => {
    useEditorStore.setState({
      mediaSkimPreviewMediaId: 'media-1',
      mediaSkimPreviewFrame: 24,
    });

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    expect(screen.getByTestId('inline-source-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('video-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument();
  });

  it('shows the compound clip skim preview in the program monitor while hover preview is active', () => {
    useEditorStore.setState({
      compoundClipSkimPreviewCompositionId: 'composition-1',
      compoundClipSkimPreviewFrame: 42,
    });

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    expect(screen.getByTestId('inline-composition-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('video-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument();
  });

  it('enables knot conversion buttons for a selected point and dispatches the request', () => {
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
    ]);
    useMaskEditorStore.getState().startEditing('path-1');

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    act(() => {
      useMaskEditorStore.getState().selectVertex(1);
    });

    expect(screen.getByRole('button', { name: '角点' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '贝塞尔' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '贝塞尔' }));

    expect(useMaskEditorStore.getState().convertSelectedVertexRequestMode).toBe('bezier');
    expect(useMaskEditorStore.getState().convertSelectedVertexRequestVersion).toBe(1);
  });

  it('shows the selected point count for multi-selection', () => {
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
    ]);
    useMaskEditorStore.getState().startEditing('path-1');

    render(
      <PreviewArea
        project={{ width: 1920, height: 1080, fps: 30 }}
      />
    );

    act(() => {
      useMaskEditorStore.getState().selectVertices([0, 1, 2, 3], 3);
    });

    expect(screen.getByRole('button', { name: '角点' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '贝塞尔' })).toBeEnabled();
    expect(screen.getByText('已选中 4 个点，可进行节点转换。')).toBeInTheDocument();
  });
});
