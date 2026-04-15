import { render } from '@testing-library/react';
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

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) => (
    selector ? selector(state) : state
  )) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState;
  };
  hook.getState = () => state;
  return hook;
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

describe('VideoContent pooled handoff', () => {
  beforeEach(() => {
    preloadSourceMock.mockClear();
    acquireForClipMock.mockClear();
    releaseClipMock.mockClear();
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

  it('stays detached in player mode and never acquires a pooled video element', () => {
    const { container } = render(
      <VideoContent
        item={{
          id: 'clip-player-detached',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip Player Detached',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
      />,
    );

    expect(container.querySelector('[data-detached-preview-video="clip-player-detached"]')).toBeInTheDocument();
    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
    expect(releaseClipMock).not.toHaveBeenCalled();
  });

  it('stays detached across same-lane item handoffs', () => {
    const { container, rerender } = render(
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
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
      />,
    );

    expect(container.querySelector('[data-detached-preview-video="clip-a"]')).toBeInTheDocument();

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
        safeTrimBefore={30}
        playbackRate={1}
        sourceFps={30}
      />,
    );

    expect(container.querySelector('[data-detached-preview-video="clip-b"]')).toBeInTheDocument();
    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
    expect(releaseClipMock).not.toHaveBeenCalled();
  });

  it('stays detached while streaming playback owns visuals', () => {
    playbackState.isPlaying = true;
    previewBridgeState.visualPlaybackMode = 'streaming';

    const { container } = render(
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
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
      />,
    );

    expect(container.querySelector('[data-detached-preview-video="clip-streaming"]')).toBeInTheDocument();
    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
  });

  it('stays detached while paused rendered preview owns the frame', () => {
    previewBridgeState.visualPlaybackMode = 'rendered_preview';
    previewBridgeState.displayedFrame = 12;

    const { container } = render(
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
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
      />,
    );

    expect(container.querySelector('[data-detached-preview-video="clip-overlay-owned"]')).toBeInTheDocument();
    expect(acquireForClipMock).not.toHaveBeenCalled();
    expect(preloadSourceMock).not.toHaveBeenCalled();
  });
});
