import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  preloadSourceMock: vi.fn(() => Promise.resolve()),
  acquireForClipMock: vi.fn(),
  releaseClipMock: vi.fn(),
  registerDomVideoElementMock: vi.fn(),
  unregisterDomVideoElementMock: vi.fn(),
  ensureAudioContextResumedMock: vi.fn(),
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
  clockState: {
    currentFrame: 0,
  },
  rvfcRequestMock: vi.fn(),
  rvfcCancelMock: vi.fn(),
  lastRvfcCallback: null as FrameRequestCallback | null,
}));

testState.pool = {
  preloadSource: testState.preloadSourceMock,
  acquireForClip: testState.acquireForClipMock,
  releaseClip: testState.releaseClipMock,
};

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) => (
    selector ? selector(state) : state
  )) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState;
  };
  hook.getState = () => state;
  return hook;
}

function installRvfcMocks() {
  testState.lastRvfcCallback = null;
  testState.rvfcRequestMock.mockImplementation((callback: FrameRequestCallback) => {
    testState.lastRvfcCallback = callback;
    return 1;
  });
  testState.rvfcCancelMock.mockImplementation(() => {});

  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
    configurable: true,
    writable: true,
    value: testState.rvfcRequestMock,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', {
    configurable: true,
    writable: true,
    value: testState.rvfcCancelMock,
  });
}

function createMockVideoElement(initialCurrentTime = 0): HTMLVideoElement & { __currentTimeAssignments: number[] } {
  const element = document.createElement('video') as HTMLVideoElement & { __currentTimeAssignments: number[] };
  let currentTimeValue = initialCurrentTime;
  let pausedValue = true;
  element.__currentTimeAssignments = [];

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
      element.__currentTimeAssignments.push(value);
    },
  });
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => pausedValue,
  });

  element.playbackRate = 1;
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
    currentFrame: testState.clockState.currentFrame,
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

vi.mock('../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}));

vi.mock('@/features/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}));

vi.mock('@/features/composition-runtime/utils/dom-video-element-registry', () => ({
  registerDomVideoElement: testState.registerDomVideoElementMock,
  unregisterDomVideoElement: testState.unregisterDomVideoElementMock,
}));

vi.mock('./video-audio-context', () => ({
  applyVideoElementAudioVolume: vi.fn(),
  useVideoAudioVolume: vi.fn(() => 1),
  connectedVideoElements: new WeakSet<HTMLVideoElement>(),
  videoAudioContexts: new WeakMap<HTMLVideoElement, AudioContext>(),
  ensureAudioContextResumed: testState.ensureAudioContextResumedMock,
}));

describe('VideoContent RVFC handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    installRvfcMocks();
    testState.preloadSourceMock.mockClear();
    testState.acquireForClipMock.mockClear();
    testState.releaseClipMock.mockClear();
    testState.registerDomVideoElementMock.mockClear();
    testState.unregisterDomVideoElementMock.mockClear();
    testState.ensureAudioContextResumedMock.mockClear();
    testState.rvfcRequestMock.mockClear();
    testState.rvfcCancelMock.mockClear();
    testState.lastRvfcCallback = null;
    testState.playbackState.currentFrame = 0;
    testState.playbackState.isPlaying = true;
    testState.playbackState.previewFrame = null;
    testState.playbackState.volume = 1;
    testState.playbackState.muted = false;
    testState.gizmoState.activeGizmo = null;
    testState.gizmoState.preview = null;
    testState.timelineState.keyframes = [];
    testState.clockState.currentFrame = 0;
  });

  it('starts RVFC when shared transition sync releases without a synchronous reseek', async () => {
    const pooledElement = createMockVideoElement(0);
    testState.acquireForClipMock.mockReturnValue(pooledElement);

    const { VideoContent } = await import('./video-content');

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
          _sharedTransitionSync: true,
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1.5}
        sourceFps={30}
      />,
    );

    await waitFor(() => {
      expect(testState.acquireForClipMock).toHaveBeenCalledTimes(1);
      expect(pooledElement.play).toHaveBeenCalled();
    });

    testState.rvfcRequestMock.mockClear();
    pooledElement.__currentTimeAssignments = [];

    rerender(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
          _sharedTransitionSync: false,
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1.5}
        sourceFps={30}
      />,
    );

    await waitFor(() => {
      expect(testState.rvfcRequestMock).toHaveBeenCalledTimes(1);
    });

    expect(pooledElement.__currentTimeAssignments).toEqual([]);
  });

  it('uses RVFC rate correction after transition sync handoff for moderate drift', async () => {
    const pooledElement = createMockVideoElement(0);
    testState.acquireForClipMock.mockReturnValue(pooledElement);

    const { VideoContent } = await import('./video-content');

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
          _sharedTransitionSync: true,
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1.5}
        sourceFps={30}
      />,
    );

    await waitFor(() => {
      expect(pooledElement.play).toHaveBeenCalled();
    });

    testState.rvfcRequestMock.mockClear();
    pooledElement.__currentTimeAssignments = [];

    rerender(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
          _sharedTransitionSync: false,
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1.5}
        sourceFps={30}
      />,
    );

    await waitFor(() => {
      expect(testState.rvfcRequestMock).toHaveBeenCalledTimes(1);
      expect(testState.lastRvfcCallback).not.toBeNull();
    });

    pooledElement.currentTime = 0.05;
    pooledElement.__currentTimeAssignments = [];

    await act(async () => {
      testState.lastRvfcCallback?.(16, {} as VideoFrameCallbackMetadata);
    });

    expect(pooledElement.__currentTimeAssignments).toEqual([]);
    expect(pooledElement.playbackRate).not.toBe(1.5);
  });
});
