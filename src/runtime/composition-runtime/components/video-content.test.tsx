import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { shouldIssueCoalescedReverseVideoSeek } from '../utils/video-sync-plan'
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

vi.mock('@/runtime/composition-runtime/deps/player', () => ({
  useSequenceContext: () => ({ localFrame: 0, from: 0, durationInFrames: 120, parentFrom: 0 }),
  useVideoSourcePool: () => testState.pool!,
  useClock: () => ({
    currentFrame: 0,
    onFrameChange: () => () => {},
  }),
  useClockPlaybackRate: () => 1,
  interpolate: () => 0,
  isVideoPoolAbortError: () => false,
}))

vi.mock('@/runtime/composition-runtime/deps/stores', () => ({
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

vi.mock('@/runtime/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}))

vi.mock('@/runtime/composition-runtime/utils/dom-video-element-registry', () => ({
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

  it('keeps a decoder pre-warm single-flight and restores its paused source time', async () => {
    vi.useFakeTimers()
    playbackState.isPlaying = false
    const pooledElement = createMockVideoElement()
    let resolvePlay!: () => void
    pooledElement.play = vi.fn(() => {
      Object.defineProperty(pooledElement, 'paused', {
        configurable: true,
        get: () => false,
      })
      return new Promise<void>((resolve) => {
        resolvePlay = resolve
      })
    })
    acquireForClipMock.mockReturnValue(pooledElement)

    const rendered = render(
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(pooledElement.play).toHaveBeenCalledTimes(1)
    const preWarmStartTime = pooledElement.currentTime

    // play() can emit canplay while its promise is still pending. That signal
    // must not start another warm or leave the element on a decoded-ahead frame.
    pooledElement.currentTime = 0.25
    pooledElement.dispatchEvent(new Event('canplay'))
    await act(async () => {
      resolvePlay()
      await Promise.resolve()
    })

    expect(pooledElement.pause).toHaveBeenCalled()
    expect(pooledElement.currentTime).toBe(preWarmStartTime)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(pooledElement.play).toHaveBeenCalledTimes(1)
    rendered.unmount()
    vi.useRealTimers()
  })

  it('never plays a visibly presented paused video to warm its decoder', async () => {
    vi.useFakeTimers()
    playbackState.isPlaying = false
    const pooledElement = createMockVideoElement()
    pooledElement.getClientRects = vi.fn(() => ({ length: 1 }) as unknown as DOMRectList)
    acquireForClipMock.mockReturnValue(pooledElement)

    const rendered = render(
      <VideoContent
        item={{
          id: 'clip-visible',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Visible clip',
          src: 'blob:test',
          _poolClipId: 'group-origin-visible',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(pooledElement.isConnected).toBe(true)
    expect(pooledElement.play).not.toHaveBeenCalled()
    rendered.unmount()
    vi.useRealTimers()
  })
})

describe('coalesced reverse video seeking', () => {
  it('keeps only one browser seek in flight and accepts the newest target after settlement', () => {
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: false,
        seekInFlight: false,
        currentTime: 8,
        targetTime: 7.5,
      }),
    ).toBe(true)
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: true,
        seekInFlight: true,
        currentTime: 8,
        targetTime: 6,
      }),
    ).toBe(false)
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: false,
        seekInFlight: false,
        currentTime: 6.0005,
        targetTime: 6,
      }),
    ).toBe(false)
  })
})
