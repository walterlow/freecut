import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  useItemsStore,
  useTimelineStore,
  useTimelineSettingsStore,
  useTransitionsStore,
} from '@/features/preview/deps/timeline-store';
import { useMediaLibraryStore } from '@/features/preview/deps/media-library';
import { useGizmoStore } from '../stores/gizmo-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';

const seekToMock = vi.fn<(frame: number) => void>();
const playMock = vi.fn();
const pauseMock = vi.fn();
const mockState = vi.hoisted(() => {
  const blobUrls = new Map<string, string>();
  const listeners = new Set<() => void>();
  const version = { current: 0 };
  const resolveMediaUrlMock = vi.fn(async (mediaId: string) => blobUrls.get(mediaId) ?? '');
  const resolveProxyUrlMock = vi.fn<(mediaId: string) => string | null>(() => null);

  const publishVersion = () => {
    version.current += 1;
    for (const listener of listeners) {
      listener();
    }
  };

  const setBlobUrl = (mediaId: string, url: string | null) => {
    const current = blobUrls.get(mediaId) ?? null;
    if (current === url) return;

    if (url === null) {
      blobUrls.delete(mediaId);
    } else {
      blobUrls.set(mediaId, url);
    }
    publishVersion();
  };

  const subscribeVersion = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    blobUrls,
    listeners,
    version,
    resolveMediaUrlMock,
    resolveProxyUrlMock,
    publishVersion,
    setBlobUrl,
    subscribeVersion,
  };
});

const {
  blobUrls: mockBlobUrls,
  listeners: blobUrlListeners,
  version: mockBlobUrlVersion,
  resolveMediaUrlMock,
  resolveProxyUrlMock,
  setBlobUrl: setMockBlobUrl,
} = mockState;
let mockedPlayerFrame = 0;
let mockedPlayerIsPlaying = false;
let deferPlayerSeekCompletion = false;
let completeDeferredPlayerSeek: ((frameOverride?: number) => void) | null = null;
let lastPlayerDimensions: { width: number; height: number } | null = null;
let playerDimensionsHistory: Array<{ width: number; height: number }> = [];
let canvasGetContextSpy: ReturnType<typeof vi.spyOn> | null = null;
let lastCompositionKeyframes: Array<{
  itemId: string;
  properties: Array<{
    property: string;
    keyframes: Array<{ frame: number; value: number }>;
  }>;
}> = [];
let lastCompositionMediaSources: string[] = [];
const rendererMockState = vi.hoisted(() => {
  type RendererMock = {
    preload: ReturnType<typeof vi.fn>;
    renderFrame: ReturnType<typeof vi.fn>;
    prewarmFrame: ReturnType<typeof vi.fn>;
    invalidateFrameCache: ReturnType<typeof vi.fn>;
    setDomVideoElementProvider: ReturnType<typeof vi.fn>;
    getScrubbingCache: () => null;
    dispose: ReturnType<typeof vi.fn>;
  };

  const instances: RendererMock[] = [];
  const create = vi.fn(async () => {
    const renderer: RendererMock = {
      preload: vi.fn(async () => {}),
      renderFrame: vi.fn(async () => {}),
      prewarmFrame: vi.fn(async () => {}),
      invalidateFrameCache: vi.fn(),
      setDomVideoElementProvider: vi.fn(),
      getScrubbingCache: () => null,
      dispose: vi.fn(),
    };
    instances.push(renderer);
    return renderer;
  });

  return {
    create,
    instances,
  };
});

const createCompositionRendererMock = rendererMockState.create;

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({
      width: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D;
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/infrastructure/browser/blob-url-manager', async () => {
  const React = await import('react');

  return {
    blobUrlManager: {
      get: (mediaId: string) => mockState.blobUrls.get(mediaId) ?? null,
      has: (mediaId: string) => mockState.blobUrls.has(mediaId),
      acquire: (mediaId: string) => {
        const existing = mockState.blobUrls.get(mediaId);
        if (existing) return existing;
        const generated = `blob:mock-${mediaId}-${mockState.version.current + 1}`;
        mockState.blobUrls.set(mediaId, generated);
        mockState.publishVersion();
        return generated;
      },
      release: (mediaId: string) => {
        if (mockState.blobUrls.delete(mediaId)) {
          mockState.publishVersion();
        }
      },
      invalidate: (mediaId: string) => {
        if (mockState.blobUrls.delete(mediaId)) {
          mockState.publishVersion();
        }
      },
      invalidateAll: () => {
        if (mockState.blobUrls.size === 0) return;
        mockState.blobUrls.clear();
        mockState.publishVersion();
      },
      releaseAll: () => {
        if (mockState.blobUrls.size === 0) return;
        mockState.blobUrls.clear();
        mockState.publishVersion();
      },
      subscribe: mockState.subscribeVersion,
      getSnapshot: () => mockState.version.current,
    },
    useBlobUrlVersion: () =>
      React.useSyncExternalStore(mockState.subscribeVersion, () => mockState.version.current),
  };
});

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: mockState.resolveMediaUrlMock,
  resolveProxyUrl: mockState.resolveProxyUrlMock,
}));

vi.mock('@/features/preview/deps/export', () => ({
  createCompositionRenderer: rendererMockState.create,
}));

vi.mock('@/features/preview/deps/player-core', async () => {
  const React = await import('react');

  const MockPlayer = React.forwardRef<
    {
      seekTo: (frame: number) => void;
      play: () => void;
      pause: () => void;
      getCurrentFrame: () => number;
      isPlaying: () => boolean;
    },
    React.PropsWithChildren<{
      width?: number;
      height?: number;
      onFrameChange?: (frame: number) => void;
    } & Record<string, unknown>>
  >(({ children, width, height, onFrameChange }, ref) => {
    const [renderTick, setRenderTick] = React.useState(0);
    const onFrameChangeRef = React.useRef(onFrameChange);
    const safeWidth = Number.isFinite(width) ? Number(width) : 0;
    const safeHeight = Number.isFinite(height) ? Number(height) : 0;
    lastPlayerDimensions = { width: safeWidth, height: safeHeight };
    playerDimensionsHistory.push(lastPlayerDimensions);

    React.useEffect(() => {
      onFrameChangeRef.current = onFrameChange;
    }, [onFrameChange]);

    React.useImperativeHandle(ref, () => ({
      seekTo: (frame: number) => {
        const nextFrame = Math.round(frame);
        seekToMock(nextFrame);
        if (deferPlayerSeekCompletion) {
          completeDeferredPlayerSeek = (frameOverride) => {
            const resolvedFrame = frameOverride ?? nextFrame;
            mockedPlayerFrame = resolvedFrame;
            setRenderTick((value) => value + 1);
            onFrameChangeRef.current?.(resolvedFrame);
            if (resolvedFrame === nextFrame) {
              completeDeferredPlayerSeek = null;
            }
          };
          return;
        }
        mockedPlayerFrame = nextFrame;
        setRenderTick((value) => value + 1);
        onFrameChangeRef.current?.(nextFrame);
      },
      play: () => {
        mockedPlayerIsPlaying = true;
        playMock();
        setRenderTick((value) => value + 1);
      },
      pause: () => {
        mockedPlayerIsPlaying = false;
        pauseMock();
        setRenderTick((value) => value + 1);
      },
      getCurrentFrame: () => mockedPlayerFrame,
      isPlaying: () => mockedPlayerIsPlaying,
    }), []);

    const syncedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(
        child as React.ReactElement<Record<string, unknown>>,
        { __playerFrameTick: renderTick }
      );
    });

    return <div data-testid="mock-player">{syncedChildren}</div>;
  });
  MockPlayer.displayName = 'MockPlayer';

  return {
    Player: MockPlayer,
    AbsoluteFill: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
  };
});

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: (props: {
    tracks?: Array<{ items?: Array<{ id?: string; src?: string; transform?: { x?: number } }> }>;
    keyframes?: Array<{
      itemId: string;
      properties: Array<{
        property: string;
        keyframes: Array<{ frame: number; value: number }>;
      }>;
    }>;
  }) => {
    lastCompositionKeyframes = props.keyframes ?? [];
    lastCompositionMediaSources = (props.tracks ?? [])
      .flatMap((track) => track.items ?? [])
      .map((item) => item.src ?? '')
      .filter((src) => src.length > 0);
    return <div data-testid="mock-player-frame">{String(mockedPlayerFrame)}</div>;
  },
  getBestDomVideoElementForItem: vi.fn(() => null),
}));

vi.mock('./gizmo-overlay', () => ({
  GizmoOverlay: () => null,
}));

vi.mock('./rolling-edit-overlay', () => ({
  RollingEditOverlay: () => null,
}));

vi.mock('./ripple-edit-overlay', () => ({
  RippleEditOverlay: () => null,
}));

vi.mock('./slip-edit-overlay', () => ({
  SlipEditOverlay: () => null,
}));

vi.mock('./slide-edit-overlay', () => ({
  SlideEditOverlay: () => null,
}));

import { VideoPreview } from './video-preview';

function resetStores() {
  usePlaybackStore.setState({
    currentFrame: 0,
    currentFrameEpoch: 0,
    displayedFrame: null,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    captureFrame: null,
    useProxy: true,
    previewQuality: 1,
  });

  useItemsStore.getState().setTracks([]);
  useItemsStore.getState().setItems([]);
  useTimelineStore.setState({ keyframes: [] });
  useTransitionsStore.getState().setTransitions([]);
  useTimelineSettingsStore.setState({
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
    isTimelineLoading: false,
  });

  useGizmoStore.setState({
    activeGizmo: null,
    previewTransform: null,
    preview: null,
    snapLines: [],
    canvasBackgroundPreview: null,
  });
  useMaskEditorStore.getState().stopEditing();

  useMediaLibraryStore.setState({
    mediaItems: [],
    mediaById: {},
    brokenMediaIds: [],
  });
}

function setDocumentVisibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: hidden ? 'hidden' : 'visible',
  });
}

describe('VideoPreview sync behavior', () => {
  beforeEach(() => {
    mockedPlayerFrame = 0;
    mockedPlayerIsPlaying = false;
    deferPlayerSeekCompletion = false;
    completeDeferredPlayerSeek = null;
    lastPlayerDimensions = null;
    playerDimensionsHistory = [];
    seekToMock.mockReset();
    playMock.mockReset();
    pauseMock.mockReset();
    lastCompositionKeyframes = [];
    lastCompositionMediaSources = [];
    mockBlobUrls.clear();
    blobUrlListeners.clear();
    mockBlobUrlVersion.current = 0;
    resolveMediaUrlMock.mockClear();
    resolveProxyUrlMock.mockClear();
    createCompositionRendererMock.mockClear();
    rendererMockState.instances.length = 0;
    canvasGetContextSpy?.mockRestore();
    canvasGetContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return createMockCanvasContext();
      }
      return null;
    });
    localStorage.clear();
    setDocumentVisibility(false);
    resetStores();
    (globalThis as unknown as { OffscreenCanvas: typeof HTMLCanvasElement }).OffscreenCanvas = function OffscreenCanvasMock(
      width: number,
      height: number,
    ) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as HTMLCanvasElement;
    } as unknown as typeof HTMLCanvasElement;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
  });

  it('seeks to currentFrame when previewFrame is stale and unchanged (ruler click path)', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(120);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(120);
    });
    seekToMock.mockClear();

    act(() => {
      // Simulates ruler click updating currentFrame while stale previewFrame lingers.
      usePlaybackStore.getState().setCurrentFrame(42);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(42);
    });
  });

  it('clears stale previewFrame when gizmo interaction starts', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(60);
    });
    expect(usePlaybackStore.getState().previewFrame).toBe(60);

    act(() => {
      useGizmoStore.setState({
        activeGizmo: {
          mode: 'translate',
          activeHandle: null,
          startPoint: { x: 0, y: 0 },
          startTransform: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
          currentPoint: { x: 0, y: 0 },
          shiftKey: false,
          ctrlKey: false,
          itemId: 'item-1',
        },
      });
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
    });
  });

  it('invalidates the current fast-scrub frame when single-item gizmo preview changes', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
      } as ReturnType<typeof useItemsStore.getState>['items'][number],
    ]);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });

    act(() => {
      useGizmoStore.setState({
        activeGizmo: {
          mode: 'scale',
          activeHandle: 'se',
          startPoint: { x: 0, y: 0 },
          startTransform: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
          currentPoint: { x: 0, y: 0 },
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          itemId: 'item-1',
          itemType: 'video',
        },
        previewTransform: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
        },
      });
    });

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled();
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalled();
    });
    renderer.invalidateFrameCache.mockClear();

    act(() => {
      useGizmoStore.setState({
        previewTransform: {
          x: 0,
          y: 0,
          width: 180,
          height: 180,
          rotation: 0,
          opacity: 1,
        },
      });
    });

    await waitFor(() => {
      expect(renderer.invalidateFrameCache).toHaveBeenCalledWith([0]);
    });
  });

  it('invalidates the current fast-scrub frame when mask point preview vertices change', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
      } as ReturnType<typeof useItemsStore.getState>['items'][number],
    ]);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(24);
    });

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled();
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalled();
    });
    renderer.invalidateFrameCache.mockClear();

    act(() => {
      useMaskEditorStore.setState({
        isEditing: true,
        editingItemId: 'mask-1',
        previewVertices: [
          {
            position: [0.3, 0.2],
            inHandle: [0.3, 0.2],
            outHandle: [0.3, 0.2],
          },
        ],
      });
    });

    await waitFor(() => {
      expect(renderer.invalidateFrameCache).toHaveBeenCalledWith([24]);
    });
  });

  it('clears stale previewFrame on mount', async () => {
    act(() => {
      usePlaybackStore.getState().setPreviewFrame(60);
    });
    expect(usePlaybackStore.getState().previewFrame).toBe(60);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
    });
  });

  it('hands off scrub preview back to current frame when previewFrame is cleared', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      // Timeline scrub path updates both preview and main frame while dragging.
      usePlaybackStore.getState().setPreviewFrame(48);
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
    seekToMock.mockClear();

    act(() => {
      // Scrub release clears previewFrame.
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
  });

  it('keeps ruler drag on fast-scrub presentation until previewFrame is cleared', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(48);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(seekToMock).not.toHaveBeenCalled();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
  });

  it('keeps backward ruler drag on fast-scrub presentation', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(48);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(seekToMock).not.toHaveBeenCalled();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(46);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(seekToMock).not.toHaveBeenCalled();
  });

  it('prefers the Player path for glowing animated text scrubs', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-text',
        name: 'Text',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'text-1',
        type: 'text',
        trackId: 'track-text',
        from: 0,
        durationInFrames: 120,
        label: 'Glow text',
        text: 'Glow',
        color: '#ffffff',
        textShadow: {
          offsetX: 0,
          offsetY: 0,
          blur: 18,
          color: '#00ffff',
        },
      } as unknown as (typeof useItemsStore.getState)['items'][number],
    ]);
    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'text-1',
          properties: [
            {
              property: 'opacity',
              keyframes: [
                { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
                { id: 'kf-2', frame: 12, value: 1, easing: 'linear' },
              ],
            },
          ],
        },
      ],
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(48);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });

    expect(scrubCanvas.style.visibility).toBe('hidden');
    expect(usePlaybackStore.getState().displayedFrame).toBeNull();
  });

  it('keeps fast-scrub overlay visible until Player confirms the exact scrub release frame', async () => {
    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(48);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    seekToMock.mockClear();

    deferPlayerSeekCompletion = true;
    act(() => {
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
    expect(usePlaybackStore.getState().displayedFrame).toBe(48);
    expect(scrubCanvas.style.visibility).toBe('visible');

    act(() => {
      completeDeferredPlayerSeek?.(47);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(48);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      completeDeferredPlayerSeek?.(48);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBeNull();
      expect(scrubCanvas.style.visibility).toBe('hidden');
    });
  });

  it('shows the playback transition overlay only while a transition is active during playback', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'clip-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 40,
        durationInFrames: 60,
        src: 'blob:right',
      } as TimelineItem,
    ]);
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition-1',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        trackId: 'track-video',
        durationInFrames: 20,
      },
    ]);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled();
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(48);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(70);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBeNull();
      expect(scrubCanvas.style.visibility).toBe('hidden');
    });
  });

  it('pre-renders the first transition frame before handoff and reuses it at transition start', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'clip-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 40,
        durationInFrames: 60,
        src: 'blob:right',
      } as TimelineItem,
    ]);
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition-1',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        trackId: 'track-video',
        durationInFrames: 20,
      },
    ]);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
      usePlaybackStore.getState().setCurrentFrame(35);
    });

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled();
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(40);
      expect(renderer.prewarmFrame).toHaveBeenCalledWith(41);
      expect(renderer.prewarmFrame).toHaveBeenCalledWith(42);
      expect(scrubCanvas.style.visibility).toBe('hidden');
      expect(usePlaybackStore.getState().displayedFrame).toBeNull();
    });

    const prerenderedStartFrameCalls = renderer.renderFrame.mock.calls.filter(
      ([frame]) => frame === 40,
    ).length;

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(40);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(40);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    expect(
      renderer.renderFrame.mock.calls.filter(([frame]) => frame === 40).length,
    ).toBe(prerenderedStartFrameCalls);
  });

  it('starts transition prewarm when a transition is added during scrub preview', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'clip-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 40,
        durationInFrames: 60,
        src: 'blob:right',
      } as TimelineItem,
    ]);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(35);
    });

    const firstRenderer = await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
      return rendererMockState.instances[rendererMockState.instances.length - 1]!;
    });

    await waitFor(() => {
      expect(firstRenderer.renderFrame).toHaveBeenCalledWith(35);
    });

    act(() => {
      useTransitionsStore.getState().setTransitions([
        {
          id: 'transition-1',
          type: 'crossfade',
          presentation: 'fade',
          timing: 'linear',
          leftClipId: 'clip-left',
          rightClipId: 'clip-right',
          trackId: 'track-video',
          durationInFrames: 20,
        },
      ]);
    });

    const updatedRenderer = await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(1);
      return rendererMockState.instances[rendererMockState.instances.length - 1]!;
    });

    await waitFor(() => {
      expect(updatedRenderer.renderFrame).toHaveBeenCalledWith(40);
      expect(updatedRenderer.prewarmFrame).toHaveBeenCalledWith(41);
      expect(updatedRenderer.prewarmFrame).toHaveBeenCalledWith(42);
    });
  });

  it('keeps the transition overlay active for a short cooldown after the overlap ends', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'clip-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 40,
        durationInFrames: 60,
        src: 'blob:right',
      } as TimelineItem,
    ]);
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition-1',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        trackId: 'track-video',
        durationInFrames: 20,
      },
    ]);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
      usePlaybackStore.getState().setCurrentFrame(58);
    });

    const renderer = await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
      return rendererMockState.instances[rendererMockState.instances.length - 1]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(58);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(61);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(61);
      expect(usePlaybackStore.getState().displayedFrame).toBe(61);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(64);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBeNull();
      expect(scrubCanvas.style.visibility).toBe('hidden');
    });
  });

  it('on play start, clears previewFrame and seeks to current playhead frame', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(72);
      usePlaybackStore.getState().setPreviewFrame(120);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(120);
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
      expect(seekToMock).toHaveBeenCalledWith(72);
      expect(playMock).toHaveBeenCalled();
    });
  });

  it('keeps playback running across tab visibility changes', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(playMock).toHaveBeenCalled();
    });
    playMock.mockClear();

    act(() => {
      setDocumentVisibility(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
    });

    act(() => {
      setDocumentVisibility(false);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
    });
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it('renders keyframed transform values correctly after scrub and seek handoff', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-1',
        name: 'Track 1',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'text',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 120,
        transform: { x: 0, y: 0, width: 100, height: 60, rotation: 0, opacity: 1 },
      } as unknown as (typeof useItemsStore.getState)['items'][number],
    ]);
    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: 'kf-48', frame: 48, value: 148, easing: 'linear' },
                { id: 'kf-72', frame: 72, value: 172, easing: 'linear' },
              ],
            },
          ],
        },
      ],
    });

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
      usePlaybackStore.getState().setPreviewFrame(48);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
      expect(screen.getByTestId('mock-player-frame')).toHaveTextContent('48');
    });
    seekToMock.mockClear();

    act(() => {
      // Simulate stale hover preview lingering while user performs a ruler seek.
      usePlaybackStore.getState().setPreviewFrame(120);
      usePlaybackStore.getState().setCurrentFrame(72);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(72);
      expect(screen.getByTestId('mock-player-frame')).toHaveTextContent('72');
      const keyframesForItem = lastCompositionKeyframes.find((entry) => entry.itemId === 'item-1');
      const xProperty = keyframesForItem?.properties.find((property) => property.property === 'x');
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 48 && keyframe.value === 148)).toBe(true);
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 72 && keyframe.value === 172)).toBe(true);
    });
  });

  it('keeps Player render geometry fixed when preview quality changes', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(0.33);
    });

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(1);
    });

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    expect(
      playerDimensionsHistory.every(
        (entry) => entry.width === 1920 && entry.height === 1080
      )
    ).toBe(true);
  });

  it('refreshes stale resolved media URLs after blob URL invalidation', async () => {
    const mediaId = 'media-1';
    setMockBlobUrl(mediaId, 'blob:initial');

    const media = {
      id: mediaId,
      projectId: 'project-1',
      fileName: 'clip.mp4',
      fileSize: 1024,
      mimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      duration: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as (typeof useMediaLibraryStore.getState)['mediaItems'][number];

    useMediaLibraryStore.setState({
      mediaItems: [media],
      mediaById: {
        [mediaId]: media,
      },
    });

    useItemsStore.getState().setTracks([
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'item-video-1',
        type: 'video',
        trackId: 'track-video',
        mediaId,
        from: 0,
        durationInFrames: 120,
      } as unknown as (typeof useItemsStore.getState)['items'][number],
    ]);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(lastCompositionMediaSources).toContain('blob:initial');
    });

    act(() => {
      setMockBlobUrl(mediaId, 'blob:refreshed');
    });

    await waitFor(() => {
      expect(lastCompositionMediaSources).toContain('blob:refreshed');
    });

    const resolveCallsForMedia = resolveMediaUrlMock.mock.calls.filter(
      ([id]) => id === mediaId
    ).length;
    expect(resolveCallsForMedia).toBeGreaterThan(1);
  });
});
