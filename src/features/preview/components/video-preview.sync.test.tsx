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
const decoderPrewarmMockState = vi.hoisted(() => ({
  backgroundPreseekMock: vi.fn(async () => {}),
  backgroundBatchPreseekMock: vi.fn(async () => {}),
  getDecoderPrewarmMetricsSnapshotMock: vi.fn(() => ({
    inFlight: 0,
    queued: 0,
    cacheHits: 0,
    cacheMisses: 0,
  })),
}));
const {
  backgroundPreseekMock,
  backgroundBatchPreseekMock,
  getDecoderPrewarmMetricsSnapshotMock,
} = decoderPrewarmMockState;
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
let mockedTransportFrame = 0;
let mockedTransportIsPlaying = false;
let deferTransportSeekCompletion = false;
let completeDeferredTransportSeek: ((frameOverride?: number) => void) | null = null;
let lastTransportDimensions: { width: number; height: number } | null = null;
let transportDimensionsHistory: Array<{ width: number; height: number }> = [];
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
    prewarmFrames: ReturnType<typeof vi.fn>;
    prewarmItems: ReturnType<typeof vi.fn>;
    invalidateFrameCache: ReturnType<typeof vi.fn>;
    getScrubbingCache: () => null;
    wasLastFramePresentedDirectly: ReturnType<typeof vi.fn<() => boolean>>;
    dispose: ReturnType<typeof vi.fn>;
  };

  const instances: RendererMock[] = [];
  const create = vi.fn(async () => {
    const prewarmFrame = vi.fn(async (frame: number) => {
      void frame;
    });
    const renderer: RendererMock = {
      preload: vi.fn(async () => {}),
      renderFrame: vi.fn(async () => {}),
      prewarmFrame,
      prewarmFrames: vi.fn(async (frames: number[]) => {
        for (const frame of frames) {
          await prewarmFrame(frame);
        }
      }),
      prewarmItems: vi.fn(async () => {}),
      invalidateFrameCache: vi.fn(),
      getScrubbingCache: () => null,
      wasLastFramePresentedDirectly: vi.fn(() => false),
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
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
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

function anyRendererCalledWith(method: 'renderFrame' | 'prewarmFrame', frame: number): boolean {
  return rendererMockState.instances.some((renderer) =>
    renderer[method].mock.calls.some(([calledFrame]) => calledFrame === frame),
  );
}

function countRendererCalls(method: 'renderFrame' | 'prewarmFrame', frame: number): number {
  return rendererMockState.instances.reduce((count, renderer) => (
    count + renderer[method].mock.calls.filter(([calledFrame]) => calledFrame === frame).length
  ), 0);
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

vi.mock('../utils/decoder-prewarm', () => ({
  backgroundPreseek: decoderPrewarmMockState.backgroundPreseekMock,
  backgroundBatchPreseek: decoderPrewarmMockState.backgroundBatchPreseekMock,
  getDecoderPrewarmMetricsSnapshot: decoderPrewarmMockState.getDecoderPrewarmMetricsSnapshotMock,
}));

vi.mock('@/features/preview/deps/transport-core', async () => {
  const React = await import('react');

  const createMockTransport = (testId: string) => React.forwardRef<
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
    lastTransportDimensions = { width: safeWidth, height: safeHeight };
    transportDimensionsHistory.push(lastTransportDimensions);

    React.useEffect(() => {
      onFrameChangeRef.current = onFrameChange;
    }, [onFrameChange]);

    React.useImperativeHandle(ref, () => ({
      seekTo: (frame: number) => {
        const nextFrame = Math.round(frame);
        seekToMock(nextFrame);
        if (deferTransportSeekCompletion) {
          completeDeferredTransportSeek = (frameOverride) => {
            const resolvedFrame = frameOverride ?? nextFrame;
            mockedTransportFrame = resolvedFrame;
            setRenderTick((value) => value + 1);
            onFrameChangeRef.current?.(resolvedFrame);
            if (resolvedFrame === nextFrame) {
              completeDeferredTransportSeek = null;
            }
          };
          return;
        }
        mockedTransportFrame = nextFrame;
        setRenderTick((value) => value + 1);
        onFrameChangeRef.current?.(nextFrame);
      },
      play: () => {
        mockedTransportIsPlaying = true;
        playMock();
        setRenderTick((value) => value + 1);
      },
      pause: () => {
        mockedTransportIsPlaying = false;
        pauseMock();
        setRenderTick((value) => value + 1);
      },
      getCurrentFrame: () => mockedTransportFrame,
      isPlaying: () => mockedTransportIsPlaying,
    }), []);

    const syncedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(
        child as React.ReactElement<Record<string, unknown>>,
        { __transportFrameTick: renderTick }
      );
    });

    return <div data-testid={testId}>{syncedChildren}</div>;
  });

  const MockPlayer = createMockTransport('mock-player');
  MockPlayer.displayName = 'MockPlayer';
  const MockHeadlessTransport = createMockTransport('mock-headless-transport');
  MockHeadlessTransport.displayName = 'MockHeadlessTransport';

  return {
    Player: MockPlayer,
    HeadlessTransport: MockHeadlessTransport,
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
    return <div data-testid="mock-transport-frame">{String(mockedTransportFrame)}</div>;
  },
  ensureAudioContextResumed: vi.fn(),
  ensureBufferedAudioContextResumed: vi.fn(),
  ensurePitchCorrectedAudioContextResumed: vi.fn(),
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
    displayedFrame: null,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
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

function seedAlignedTransitionProject(alignment: number = 0.5) {
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
      sourceDuration: 180,
      sourceStart: 0,
    } as TimelineItem,
    {
      id: 'clip-right',
      label: 'Right',
      type: 'video',
      trackId: 'track-video',
      from: 60,
      durationInFrames: 60,
      src: 'blob:right',
      sourceDuration: 180,
      sourceStart: 30,
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
      alignment,
    },
  ]);
}

describe('VideoPreview sync behavior', () => {
  beforeEach(() => {
    mockedTransportFrame = 0;
    mockedTransportIsPlaying = false;
    deferTransportSeekCompletion = false;
    completeDeferredTransportSeek = null;
    lastTransportDimensions = null;
    transportDimensionsHistory = [];
    seekToMock.mockReset();
    playMock.mockReset();
    pauseMock.mockReset();
    backgroundPreseekMock.mockReset();
    backgroundBatchPreseekMock.mockReset();
    getDecoderPrewarmMetricsSnapshotMock.mockClear();
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

  it('mounts the headless transport instead of the visual player shell', () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    expect(screen.getByTestId('mock-headless-transport')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-player')).toBeNull();
  });

  it('renders scrub preview through a detached work canvas and wires a dedicated presentation surface', async () => {
    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );
    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    const gpuCanvas = container.querySelectorAll('canvas')[1] as HTMLCanvasElement;

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(24);
    });

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled();
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderCanvas = createCompositionRendererMock.mock.calls[0]?.[1];
    const renderOptions = createCompositionRendererMock.mock.calls[0]?.[3] as
      | { presentationCanvas?: HTMLCanvasElement }
      | undefined;
    expect(renderCanvas).toBeTruthy();
    expect(renderCanvas).not.toBe(scrubCanvas);
    expect(renderOptions?.presentationCanvas).toBe(gpuCanvas);
  });

  it('seeks to currentFrame when previewFrame is stale and unchanged (ruler click path)', async () => {
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
      usePlaybackStore.getState().setPreviewFrame(120);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(120);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    expect(seekToMock).not.toHaveBeenCalled();
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

  it('invalidates the current preview renderer frame when single-item gizmo preview changes', async () => {
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
        effects: [
          {
            id: 'effect-1',
            enabled: true,
            effect: { type: 'gpu-effect', gpuEffectType: 'gpu-sepia', params: { amount: 0.5 } },
          },
        ],
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
      expect(renderer.invalidateFrameCache).toHaveBeenCalledWith({ frames: [0] });
    });
  });

  it('invalidates the current preview renderer frame when mask point preview vertices change', async () => {
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
      expect(renderer.invalidateFrameCache).toHaveBeenCalledWith({ frames: [24] });
    });
  });

  it('reuses the active preview renderer for committed transform updates on gpu-effect clips', async () => {
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
        id: 'item-halftone',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
        transform: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          rotation: 0,
          opacity: 1,
        },
        effects: [
          {
            id: 'effect-halftone',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-halftone',
              params: {
                patternType: 'dots',
                dotSize: 8,
                spacing: 7,
                angle: 107,
                intensity: 0.4,
                invert: false,
                size: 0.2,
                radius: 0.89,
                contrast: 0.38,
                grainOverlay: 0.29,
                grainSize: 0.35,
                grainMixer: 0.22,
              },
            },
          },
        ],
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
      usePlaybackStore.getState().setScrubFrame(24);
    });

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
    });

    renderer.invalidateFrameCache.mockClear();
    renderer.renderFrame.mockClear();
    renderer.dispose.mockClear();

    act(() => {
      useItemsStore.getState().setItems([
        {
          id: 'item-halftone',
          type: 'video',
          trackId: 'track-video',
          from: 0,
          durationInFrames: 120,
          src: 'blob:mock-video',
          transform: {
            x: 120,
            y: 0,
            width: 1920,
            height: 1080,
            rotation: 0,
            opacity: 1,
          },
          effects: [
            {
              id: 'effect-halftone',
              enabled: true,
              effect: {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-halftone',
                params: {
                  patternType: 'dots',
                  dotSize: 8,
                  spacing: 7,
                  angle: 107,
                  intensity: 0.4,
                  invert: false,
                  size: 0.2,
                  radius: 0.89,
                  contrast: 0.38,
                  grainOverlay: 0.29,
                  grainSize: 0.35,
                  grainMixer: 0.22,
                },
              },
            },
          ],
        } as TimelineItem,
      ]);
    });

    await waitFor(() => {
      expect(renderer.invalidateFrameCache).toHaveBeenCalledWith({
        ranges: [{ startFrame: 0, endFrame: 120 }],
      });
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
    });

    expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
    expect(rendererMockState.instances).toHaveLength(1);
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it('renders a paused currentFrame through the renderer surface when a gpu effect is added', async () => {
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
        id: 'item-plain',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
      } as TimelineItem,
    ]);
    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(24);
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      expect(scrubCanvas.style.visibility).toBe('visible');
      return rendererMockState.instances[0]!;
    });
    seekToMock.mockClear();
    renderer.renderFrame.mockClear();

    act(() => {
      useItemsStore.getState().setItems([
        {
          id: 'item-plain',
          type: 'video',
          trackId: 'track-video',
          from: 0,
          durationInFrames: 120,
          src: 'blob:mock-video',
          effects: [
            {
              id: 'effect-halftone',
              enabled: true,
              effect: {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-halftone',
                params: {
                  patternType: 'dots',
                  dotSize: 8,
                  spacing: 7,
                  angle: 107,
                  intensity: 0.4,
                  invert: false,
                  size: 0.2,
                  radius: 0.89,
                  contrast: 0.38,
                  grainOverlay: 0.29,
                  grainSize: 0.35,
                  grainMixer: 0.22,
                },
              },
            },
          ],
        } as TimelineItem,
      ]);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
      expect(usePlaybackStore.getState().displayedFrame).toBe(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('renders a paused currentFrame through the renderer surface for live gpu effect previews', async () => {
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
        id: 'item-previewed',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
      } as TimelineItem,
    ]);
    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(24);
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      expect(scrubCanvas.style.visibility).toBe('visible');
      return rendererMockState.instances[0]!;
    });
    seekToMock.mockClear();
    renderer.renderFrame.mockClear();

    act(() => {
      useGizmoStore.getState().setEffectsPreviewNew({
        'item-previewed': [
          {
            id: 'effect-preview',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      });
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
      expect(usePlaybackStore.getState().displayedFrame).toBe(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps the renderer surface visible when playback pauses on a gpu-effect clip', async () => {
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
        id: 'item-effected',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:mock-video',
        effects: [
          {
            id: 'effect-sepia',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      } as TimelineItem,
    ]);
    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
      usePlaybackStore.getState().setCurrentFrame(25);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(renderer.renderFrame).toHaveBeenCalledWith(25);
      expect(usePlaybackStore.getState().displayedFrame).toBe(25);
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().pause();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(false);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(usePlaybackStore.getState().displayedFrame).toBe(25);
    });
  });

  it('keeps the paused renderer surface visible across play start until playback catches up', async () => {
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
        id: 'item-effected',
        label: 'Effected',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:effected-video',
        effects: [
          {
            id: 'effect-sepia',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      } as TimelineItem,
    ]);
    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(usePlaybackStore.getState().displayedFrame).toBe(24);
    });

    playMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(playMock).toHaveBeenCalled();
    });
  });

  it('keeps renderer-owned presentation after play starts from a preview frame', async () => {
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
        id: 'item-video',
        label: 'Plain Video',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:plain-video',
      } as TimelineItem,
    ]);
    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
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
      usePlaybackStore.getState().setCurrentFrame(20);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(20);
    });
    seekToMock.mockClear();

    deferTransportSeekCompletion = true;
    act(() => {
      usePlaybackStore.getState().setPreviewFrame(24);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(24);
      expect(usePlaybackStore.getState().displayedFrame).toBe(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    expect(seekToMock).not.toHaveBeenCalled();

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(24);
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    seekToMock.mockClear();

    act(() => {
      completeDeferredTransportSeek?.(25);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(25);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('warms the first playback runway across a near-cut play start', async () => {
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
        id: 'item-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
        sourceFps: 30,
      } as TimelineItem,
      {
        id: 'item-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 60,
        durationInFrames: 60,
        src: 'blob:right',
        sourceFps: 30,
        speed: 1.5,
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
    backgroundBatchPreseekMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
      usePlaybackStore.getState().setCurrentFrame(58);
    });

    await waitFor(() => {
      expect(backgroundBatchPreseekMock).toHaveBeenCalled();
    });

    const preseekCalls = backgroundBatchPreseekMock.mock.calls as Array<[string, number[]]>;
    expect(preseekCalls.some(([src]) => src === 'blob:left')).toBe(true);
    expect(preseekCalls.some(([src]) => src === 'blob:right')).toBe(true);

    const rightPreseek = preseekCalls.find(([src]) => src === 'blob:right')?.[1] ?? [];
    expect(rightPreseek.some((timestamp) => timestamp >= 0)).toBe(true);
  });

  it('switches a paused ruler seek onto the renderer surface when landing on a gpu-effect clip', async () => {
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
        id: 'item-plain',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 20,
        src: 'blob:plain-video',
      } as TimelineItem,
      {
        id: 'item-effected',
        type: 'video',
        trackId: 'track-video',
        from: 20,
        durationInFrames: 100,
        src: 'blob:effected-video',
        effects: [
          {
            id: 'effect-sepia',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      } as TimelineItem,
    ]);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      expect(scrubCanvas.style.visibility).toBe('visible');
      return rendererMockState.instances[0]!;
    });
    seekToMock.mockClear();
    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(24);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(24);
      expect(usePlaybackStore.getState().displayedFrame).toBe(24);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps the renderer surface active after scrub release on a gpu-effect clip', async () => {
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
        id: 'item-effected',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 120,
        src: 'blob:effected-video',
        effects: [
          {
            id: 'effect-sepia',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      } as TimelineItem,
    ]);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(0);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(48);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(48);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
      expect(usePlaybackStore.getState().currentFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
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
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
    });
    expect(seekToMock).not.toHaveBeenCalled();
  });

  it('keeps ruler drag on renderer presentation until previewFrame is cleared', async () => {
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
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
    });
    expect(seekToMock).not.toHaveBeenCalled();
  });

  it('keeps backward ruler drag on renderer presentation', async () => {
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

  it('keeps backward hover preview frame-accurate for transition frames', async () => {
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
      usePlaybackStore.getState().setCurrentFrame(70);
      usePlaybackStore.getState().setPreviewFrame(70);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(70);
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(47);
    });

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 47)).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBe(47);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps backward hover preview frame-accurate for gpu-effect clips', async () => {
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
        id: 'clip-effected',
        label: 'Effected',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:effected',
        effects: [
          {
            id: 'effect-1',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.8 },
            },
          },
        ],
      } as TimelineItem,
      {
        id: 'clip-plain',
        label: 'Plain',
        type: 'video',
        trackId: 'track-video',
        from: 60,
        durationInFrames: 60,
        src: 'blob:plain',
      } as TimelineItem,
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
      usePlaybackStore.getState().setCurrentFrame(70);
      usePlaybackStore.getState().setPreviewFrame(70);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(70);
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(47);
    });

    const renderer = await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
      return rendererMockState.instances[rendererMockState.instances.length - 1]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(47);
      expect(usePlaybackStore.getState().displayedFrame).toBe(47);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('renders glowing animated text scrubs through the renderer surface', async () => {
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
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    expect(seekToMock).not.toHaveBeenCalled();
  });

  it('keeps renderer-owned preview visible across scrub release', async () => {
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

    deferTransportSeekCompletion = true;
    act(() => {
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    expect(usePlaybackStore.getState().displayedFrame).toBe(48);
    expect(scrubCanvas.style.visibility).toBe('visible');

    act(() => {
      completeDeferredTransportSeek?.(47);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(48);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      completeDeferredTransportSeek?.(48);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('renders a paused end-on-edit transition frame on mount', async () => {
    seedAlignedTransitionProject(1);

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 48)).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('renders a paused begin-on-edit transition frame on mount', async () => {
    seedAlignedTransitionProject(0);

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(68);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 68)).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBe(68);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('uses decoded transition sources while skimming backward into a begin-on-edit transition', async () => {
    seedAlignedTransitionProject(0);

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(84);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(84);
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(68);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(68);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

  });

  it('warms a wider decoded frame strip for variable-speed backward transition scrubs', async () => {
    seedAlignedTransitionProject(0);
    useItemsStore.getState().setItems([
      {
        id: 'clip-left',
        label: 'Left',
        type: 'video',
        trackId: 'track-video',
        from: 0,
        durationInFrames: 60,
        src: 'blob:left',
        sourceDuration: 180,
        sourceStart: 0,
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 60,
        durationInFrames: 60,
        src: 'blob:right',
        sourceDuration: 180,
        sourceStart: 30,
        speed: 1.5,
      } as TimelineItem,
    ]);

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    renderer.prewarmFrames.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(84);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(84);
    });

    renderer.prewarmFrames.mockClear();

    act(() => {
      usePlaybackStore.getState().setScrubFrame(68);
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(68);
      expect(renderer.prewarmFrames).toHaveBeenCalled();
    });

    const warmedFrames = renderer.prewarmFrames.mock.calls.flatMap(([frames]) => frames as number[]);
    expect(warmedFrames).toContain(68);
    expect(warmedFrames.some((frame) => frame < 68)).toBe(true);
  });

  it('prewarms masked adjustment-layer transitions on the renderer path', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-mask',
        name: 'Mask',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
      {
        id: 'track-adjustment',
        name: 'Adjustment',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 2,
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
      {
        id: 'adjustment-1',
        label: 'Adjustment',
        type: 'adjustment',
        trackId: 'track-adjustment',
        from: 40,
        durationInFrames: 20,
        effects: [
          {
            id: 'effect-sepia',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-sepia',
              params: { amount: 0.75 },
            },
          },
        ],
      } as TimelineItem,
      {
        id: 'mask-1',
        label: 'Mask',
        type: 'shape',
        trackId: 'track-mask',
        from: 40,
        durationInFrames: 20,
        shapeType: 'rectangle',
        fillColor: '#ffffff',
        isMask: true,
        maskType: 'clip',
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

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(20);
    });

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const renderer = await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalledTimes(1);
      expect(rendererMockState.instances.length).toBe(1);
      return rendererMockState.instances[0]!;
    });

    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(20);
      expect(anyRendererCalledWith('renderFrame', 40)).toBe(true);
    });

  });

  it('shows the transition overlay when playback boots inside an end-on-edit transition', async () => {
    seedAlignedTransitionProject(1);

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
      usePlaybackStore.getState().play();
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
    });

    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(renderer.renderFrame).toHaveBeenCalledWith(48);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps the renderer transition session active when playback resumes inside the same window', async () => {
    seedAlignedTransitionProject(1);

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    const { container } = render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    const scrubCanvas = container.querySelectorAll('canvas')[0] as HTMLCanvasElement;

    await waitFor(() => {
      expect(rendererMockState.instances.length).toBeGreaterThan(0);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
    const renderer = rendererMockState.instances[rendererMockState.instances.length - 1]!;
    const preResumeRenderCount = countRendererCalls('renderFrame', 48);

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBeGreaterThanOrEqual(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(countRendererCalls('renderFrame', 48)).toBeGreaterThanOrEqual(preResumeRenderCount);
      expect(renderer.renderFrame).toHaveBeenCalledWith(48);
    });
  });

  it('keeps renderer-owned playback visible through and after a transition', async () => {
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

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 48)).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(70);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(70);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps renderer-owned playback visible past variable-speed transition exit', async () => {
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
        speed: 1.5,
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

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 48)).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(60);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(60);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('re-renders variable-speed transition frames on quick re-entry after exit', async () => {
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
        speed: 1.5,
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

    const renderer = rendererMockState.instances[0]!;
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(60);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(60);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    renderer.renderFrame.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(48);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    expect(renderer.renderFrame).toHaveBeenCalledWith(48);
  });

  it('pre-renders the first transition frame before transition start', async () => {
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

    const renderer = rendererMockState.instances[0]!;
    const prerenderedStartFrameCalls = countRendererCalls('renderFrame', 40);
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(35);
      expect(anyRendererCalledWith('renderFrame', 40)).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
      expect(usePlaybackStore.getState().displayedFrame).toBe(35);
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(40);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBeGreaterThanOrEqual(40);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    expect(
      countRendererCalls('renderFrame', 40),
    ).toBeGreaterThanOrEqual(prerenderedStartFrameCalls);
  });

  it('keeps scrub preview stable when a transition is added during scrub preview', async () => {
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

    await waitFor(() => {
      expect(firstRenderer.renderFrame).toHaveBeenCalledWith(35);
      expect(usePlaybackStore.getState().displayedFrame).toBe(35);
    });
  });

  it('keeps renderer-owned playback visible after the overlap ends', async () => {
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

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 58)).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(61);
    });

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 61)).toBe(true);
      expect(usePlaybackStore.getState().displayedFrame).toBe(61);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(64);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(64);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('keeps renderer-owned playback visible for same-origin A-A handoffs', async () => {
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
        src: 'blob:shared',
        originId: 'origin-a',
      } as TimelineItem,
      {
        id: 'clip-right',
        label: 'Right',
        type: 'video',
        trackId: 'track-video',
        from: 40,
        durationInFrames: 60,
        src: 'blob:shared',
        originId: 'origin-a',
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

    await waitFor(() => {
      expect(anyRendererCalledWith('renderFrame', 58)).toBe(true);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(61);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().displayedFrame).toBe(61);
      expect(scrubCanvas.style.visibility).toBe('visible');
    });
  });

  it('on play start, promotes the visible preview frame to playback', async () => {
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
      expect(usePlaybackStore.getState().currentFrame).toBe(120);
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
      expect(screen.getByTestId('mock-transport-frame')).toHaveTextContent('48');
    });
    seekToMock.mockClear();

    act(() => {
      // Simulate stale hover preview lingering while user performs a ruler seek.
      usePlaybackStore.getState().setPreviewFrame(120);
      usePlaybackStore.getState().setCurrentFrame(72);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(72);
      expect(screen.getByTestId('mock-transport-frame')).toHaveTextContent('72');
      const keyframesForItem = lastCompositionKeyframes.find((entry) => entry.itemId === 'item-1');
      const xProperty = keyframesForItem?.properties.find((property) => property.property === 'x');
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 48 && keyframe.value === 148)).toBe(true);
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 72 && keyframe.value === 172)).toBe(true);
    });
  });

  it('keeps transport render geometry fixed when preview quality changes', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(lastTransportDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(0.33);
    });

    await waitFor(() => {
      expect(lastTransportDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(1);
    });

    await waitFor(() => {
      expect(lastTransportDimensions).toEqual({ width: 1920, height: 1080 });
    });

    expect(
      transportDimensionsHistory.every(
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
