import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoContent } from './video-content';

const testState = vi.hoisted(() => ({
  preloadSourceMock: vi.fn(() => Promise.resolve()),
  acquireForClipMock: vi.fn(),
  releaseClipMock: vi.fn(),
  pool: null as {
    preloadSource: ReturnType<typeof vi.fn>;
    acquireForClip: ReturnType<typeof vi.fn>;
    releaseClip: ReturnType<typeof vi.fn>;
  } | null,
  playbackState: {
    currentFrame: 0,
    isPlaying: true,
    previewFrame: null as number | null,
    volume: 1,
    muted: false,
  },
  gizmoState: {
    activeGizmo: null,
    preview: null as Record<string, unknown> | null,
  },
  timelineState: {
    keyframes: [] as unknown[],
  },
  previewBridgeState: {
    visualPlaybackMode: 'player' as 'player' | 'rendered_preview' | 'streaming',
    displayedFrame: null as number | null,
  },
}));

testState.pool = {
  preloadSource: testState.preloadSourceMock,
  acquireForClip: testState.acquireForClipMock,
  releaseClip: testState.releaseClipMock,
};

const {
  preloadSourceMock,
  acquireForClipMock,
  releaseClipMock,
  playbackState,
  gizmoState,
  timelineState,
  previewBridgeState,
} = testState;
const videoAudioContextMocks = vi.hoisted(() => ({
  applyVideoElementAudioStateMock: vi.fn(),
  resetVideoElementAudioStateMock: vi.fn(),
}));

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) => (
    selector ? selector(state) : state
  )) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState;
  };
  hook.getState = () => state;
  return hook;
}

function createMockVideoElement(): HTMLVideoElement {
  const element = document.createElement('video');
  let currentTimeValue = 0;
  let pausedValue = true;

  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(element, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  });
  Object.defineProperty(element, 'duration', {
    configurable: true,
    get: () => 120,
  });
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    get: () => currentTimeValue,
    set: (value: number) => {
      currentTimeValue = value;
    },
  });
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => pausedValue,
  });

  element.play = vi.fn(async () => {
    pausedValue = false;
  });
  element.pause = vi.fn(() => {
    pausedValue = true;
  });

  return element;
}

vi.mock('@/features/composition-runtime/deps/player', () => ({
  useSequenceContext: () => ({ localFrame: 0, from: 0, durationInFrames: 120, parentFrom: 0 }),
  useVideoSourcePool: () => testState.pool!,
  useClock: () => ({
    currentFrame: 0,
    onFrameChange: () => () => {},
  }),
  interpolate: () => 0,
  isVideoPoolAbortError: () => false,
}));

vi.mock('@/features/composition-runtime/deps/stores', () => ({
  usePlaybackStore: createStoreHook(testState.playbackState),
  useGizmoStore: createStoreHook(testState.gizmoState),
  useTimelineStore: createStoreHook(testState.timelineState),
}));

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
  useIsPlaying: () => testState.playbackState.isPlaying,
}));

vi.mock('@/shared/state/preview-bridge', () => ({
  usePreviewBridgeStore: createStoreHook(testState.previewBridgeState),
}));

vi.mock('../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}));

vi.mock('@/features/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}));

vi.mock('./video-audio-context', () => ({
  applyVideoElementAudioState: videoAudioContextMocks.applyVideoElementAudioStateMock,
  resetVideoElementAudioState: videoAudioContextMocks.resetVideoElementAudioStateMock,
  useVideoAudioState: vi.fn(() => ({ audioVolume: 1, resolvedAudioEqStages: [] })),
  connectedVideoElements: new WeakSet<HTMLVideoElement>(),
  videoAudioContexts: new WeakMap<HTMLVideoElement, AudioContext>(),
  ensureAudioContextResumed: vi.fn(),
}));

describe('VideoContent pooled handoff', () => {
  beforeEach(() => {
    preloadSourceMock.mockClear();
    acquireForClipMock.mockClear();
    releaseClipMock.mockClear();
    videoAudioContextMocks.applyVideoElementAudioStateMock.mockClear();
    videoAudioContextMocks.resetVideoElementAudioStateMock.mockClear();
    playbackState.currentFrame = 0;
    playbackState.isPlaying = true;
    playbackState.previewFrame = null;
    playbackState.volume = 1;
    playbackState.muted = false;
    gizmoState.activeGizmo = null;
    gizmoState.preview = null;
    timelineState.keyframes = [];
    previewBridgeState.visualPlaybackMode = 'player';
    previewBridgeState.displayedFrame = null;
  });

  it('keeps the acquired pool element when only itemId changes on the same pool lane', async () => {
    const pooledElement = createMockVideoElement();
    acquireForClipMock.mockReturnValue(pooledElement);

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip A',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <VideoContent
        item={{
          id: 'clip-b',
          type: 'video',
          trackId: 'track-1',
          from: 30,
          durationInFrames: 60,
          label: 'Clip B',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={30}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1);
    });

    expect(acquireForClipMock).toHaveBeenCalledTimes(1);
    expect(releaseClipMock).not.toHaveBeenCalled();
  });

  it('does not acquire a pooled video element while streaming playback owns visuals', () => {
    playbackState.isPlaying = true;
    previewBridgeState.visualPlaybackMode = 'streaming';

    render(
      <VideoContent
        item={{
          id: 'clip-streaming',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Streaming',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
  });

  it('does not acquire a pooled video element while paused rendered preview owns the frame', () => {
    previewBridgeState.visualPlaybackMode = 'rendered_preview';
    previewBridgeState.displayedFrame = 12;

    render(
      <VideoContent
        item={{
          id: 'clip-overlay-owned',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Overlay Owned',
          src: 'blob:test',
          _poolClipId: 'group-origin-overlay',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
  });

  it('releases the pooled video element when streaming playback takes over visuals', async () => {
    const pooledElement = createMockVideoElement();
    acquireForClipMock.mockReturnValue(pooledElement);

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-detach-streaming',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Detach Streaming',
          src: 'blob:test',
          _poolClipId: 'group-origin-3',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1);
    });

    previewBridgeState.visualPlaybackMode = 'streaming';
    rerender(
      <VideoContent
        item={{
          id: 'clip-detach-streaming',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Detach Streaming',
          src: 'blob:test',
          _poolClipId: 'group-origin-3',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(releaseClipMock).toHaveBeenCalledWith('group-origin-3', { delayMs: 400 });
    });

    previewBridgeState.visualPlaybackMode = 'player';
    rerender(
      <VideoContent
        item={{
          id: 'clip-detach-streaming',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Detach Streaming',
          src: 'blob:test',
          _poolClipId: 'group-origin-3',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(2);
    });
  });

  it('releases the pooled video element when paused rendered preview takes over visuals', async () => {
    const pooledElement = createMockVideoElement();
    acquireForClipMock.mockReturnValue(pooledElement);

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-detach-overlay',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Detach Overlay',
          src: 'blob:test',
          _poolClipId: 'group-origin-overlay-2',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1);
    });

    previewBridgeState.visualPlaybackMode = 'rendered_preview';
    previewBridgeState.displayedFrame = 24;
    rerender(
      <VideoContent
        item={{
          id: 'clip-detach-overlay',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Detach Overlay',
          src: 'blob:test',
          _poolClipId: 'group-origin-overlay-2',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    );

    await waitFor(() => {
      expect(releaseClipMock).toHaveBeenCalledWith('group-origin-overlay-2', { delayMs: 400 });
    });
  });

  it('skips DOM video audio wiring when external preview audio owns the clip', async () => {
    const pooledElement = createMockVideoElement();
    acquireForClipMock.mockReturnValue(pooledElement);

    render(
      <VideoContent
        item={{
          id: 'clip-external-audio',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip External Audio',
          src: 'blob:test',
          _poolClipId: 'group-origin-2',
        }}
        muted={true}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
        manageElementAudio={false}
      />,
    );

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1);
      expect(videoAudioContextMocks.resetVideoElementAudioStateMock).toHaveBeenCalledWith(pooledElement);
    });

    expect(videoAudioContextMocks.applyVideoElementAudioStateMock).not.toHaveBeenCalled();
  });
});
