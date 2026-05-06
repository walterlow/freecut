import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { VideoContent } from './video-content'

const testState = vi.hoisted(() => ({
  preloadSourceMock: vi.fn(() => Promise.resolve()),
  acquireForClipMock: vi.fn(),
  releaseClipMock: vi.fn(),
  registerDomVideoElementMock: vi.fn(),
  unregisterDomVideoElementMock: vi.fn(),
  pool: null as {
    preloadSource: ReturnType<typeof vi.fn>
    acquireForClip: ReturnType<typeof vi.fn>
    releaseClip: ReturnType<typeof vi.fn>
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
}))

testState.pool = {
  preloadSource: testState.preloadSourceMock,
  acquireForClip: testState.acquireForClipMock,
  releaseClip: testState.releaseClipMock,
}

const {
  preloadSourceMock,
  acquireForClipMock,
  releaseClipMock,
  registerDomVideoElementMock,
  unregisterDomVideoElementMock,
  playbackState,
  gizmoState,
  timelineState,
} = testState

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState
  }
  hook.getState = () => state
  return hook
}

function createMockVideoElement(): HTMLVideoElement {
  const element = document.createElement('video')
  let currentTimeValue = 0
  let pausedValue = true

  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => 4,
  })
  Object.defineProperty(element, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  })
  Object.defineProperty(element, 'duration', {
    configurable: true,
    get: () => 120,
  })
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    get: () => currentTimeValue,
    set: (value: number) => {
      currentTimeValue = value
    },
  })
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => pausedValue,
  })

  element.play = vi.fn(async () => {
    pausedValue = false
  })
  element.pause = vi.fn(() => {
    pausedValue = true
  })

  return element
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
}))

vi.mock('@/features/composition-runtime/deps/stores', () => ({
  usePlaybackStore: createStoreHook(testState.playbackState),
  useGizmoStore: createStoreHook(testState.gizmoState),
  useTimelineStore: createStoreHook(testState.timelineState),
}))

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
  useIsPlaying: () => testState.playbackState.isPlaying,
}))

vi.mock('../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}))

vi.mock('@/features/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}))

vi.mock('@/features/composition-runtime/utils/dom-video-element-registry', () => ({
  registerDomVideoElement: testState.registerDomVideoElementMock,
  unregisterDomVideoElement: testState.unregisterDomVideoElementMock,
}))

vi.mock('./video-audio-context', () => ({
  applyVideoElementAudioState: vi.fn(),
  useVideoAudioState: vi.fn(() => ({ audioVolume: 1, resolvedAudioEqStages: [] })),
  connectedVideoElements: new WeakSet<HTMLVideoElement>(),
  videoAudioContexts: new WeakMap<HTMLVideoElement, AudioContext>(),
  ensureAudioContextResumed: vi.fn(),
}))

describe('VideoContent pooled handoff', () => {
  beforeEach(() => {
    preloadSourceMock.mockClear()
    acquireForClipMock.mockClear()
    releaseClipMock.mockClear()
    registerDomVideoElementMock.mockClear()
    unregisterDomVideoElementMock.mockClear()
    playbackState.currentFrame = 0
    playbackState.isPlaying = true
    playbackState.previewFrame = null
    playbackState.volume = 1
    playbackState.muted = false
    gizmoState.activeGizmo = null
    gizmoState.preview = null
    timelineState.keyframes = []
  })

  it('keeps the acquired pool element when only itemId changes on the same pool lane', async () => {
    const pooledElement = createMockVideoElement()
    acquireForClipMock.mockReturnValue(pooledElement)

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
    )

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1)
      expect(registerDomVideoElementMock).toHaveBeenCalledWith('clip-a', pooledElement)
    })

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
    )

    await waitFor(() => {
      expect(unregisterDomVideoElementMock).toHaveBeenCalledWith('clip-a', pooledElement)
      expect(registerDomVideoElementMock).toHaveBeenCalledWith('clip-b', pooledElement)
    })

    expect(acquireForClipMock).toHaveBeenCalledTimes(1)
    expect(releaseClipMock).not.toHaveBeenCalled()
  })
})
