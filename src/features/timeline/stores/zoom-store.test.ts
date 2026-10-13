// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { _resetZoomStoreForTest, useSettledZoomStore, useZoomStore } from './zoom-store'

type ZoomValues = Pick<
  ReturnType<typeof useZoomStore.getState>,
  'level' | 'pixelsPerSecond' | 'contentLevel' | 'contentPixelsPerSecond' | 'isZoomInteracting'
>

interface ZoomNotification {
  current: ZoomValues
  previous: ZoomValues
}

function readZoomValues(state: ReturnType<typeof useZoomStore.getState>): ZoomValues {
  return {
    level: state.level,
    pixelsPerSecond: state.pixelsPerSecond,
    contentLevel: state.contentLevel,
    contentPixelsPerSecond: state.contentPixelsPerSecond,
    isZoomInteracting: state.isZoomInteracting,
  }
}

function hasChangedZoomValue({ current, previous }: ZoomNotification): boolean {
  return Object.keys(current).some(
    (key) => current[key as keyof ZoomValues] !== previous[key as keyof ZoomValues],
  )
}

describe('zoom-store interaction split', () => {
  let testUnsubscribers: Array<() => void> = []

  beforeEach(() => {
    testUnsubscribers = []
    vi.useFakeTimers()
    usePlaybackStore.setState({ isPlaying: false })
    _resetZoomStoreForTest()
  })

  afterEach(() => {
    for (const unsubscribe of testUnsubscribers) {
      unsubscribe()
    }
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    usePlaybackStore.setState({ isPlaying: false })
    _resetZoomStoreForTest()
  })

  function observeZoomNotifications(): ZoomNotification[] {
    const notifications: ZoomNotification[] = []
    testUnsubscribers.push(
      useZoomStore.subscribe((current, previous) => {
        notifications.push({
          current: readZoomValues(current),
          previous: readZoomValues(previous),
        })
      }),
    )
    return notifications
  }

  it('updates visual zoom immediately and settles content zoom after interaction stops', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.4)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      pixelsPerSecond: 140,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(199)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(1)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      pixelsPerSecond: 140,
      contentLevel: 1.4,
      contentPixelsPerSecond: 140,
      isZoomInteracting: false,
    })
  })

  it('publishes one changed live notification and one changed settle notification', () => {
    const notifications = observeZoomNotifications()

    useZoomStore.getState().setZoomLevelImmediate(1.4)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toEqual({
      previous: {
        level: 1,
        pixelsPerSecond: 100,
        contentLevel: 1,
        contentPixelsPerSecond: 100,
        isZoomInteracting: false,
      },
      current: {
        level: 1.4,
        pixelsPerSecond: 140,
        contentLevel: 1,
        contentPixelsPerSecond: 100,
        isZoomInteracting: true,
      },
    })

    vi.advanceTimersByTime(199)
    expect(notifications).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(notifications).toHaveLength(2)
    expect(notifications[1]).toEqual({
      previous: notifications[0]!.current,
      current: {
        level: 1.4,
        pixelsPerSecond: 140,
        contentLevel: 1.4,
        contentPixelsPerSecond: 140,
        isZoomInteracting: false,
      },
    })
    expect(notifications.every(hasChangedZoomValue)).toBe(true)
  })

  it('keeps only the latest interaction zoom target before settling', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.2)
    useZoomStore.getState().setZoomLevelImmediate(1.6)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(200)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1.6,
      isZoomInteracting: false,
    })
  })

  it('holds content zoom for the full slider gesture and settles on release', () => {
    const zoom = useZoomStore.getState()
    zoom.beginZoomGesture()
    zoom.setZoomLevelImmediate(1.4)

    vi.advanceTimersByTime(1_000)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    useZoomStore.getState().setZoomLevelImmediate(1.8)
    vi.advanceTimersByTime(1_000)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    useZoomStore.getState().endZoomGesture()
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1.8,
      isZoomInteracting: false,
    })
  })

  it('settles an explicit slider release synchronously during playback', () => {
    const requestAnimationFrameMock = vi.fn(() => 1)
    const requestIdleCallbackMock = vi.fn(() => 2)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('requestIdleCallback', requestIdleCallbackMock)
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    usePlaybackStore.setState({ isPlaying: true })

    const zoom = useZoomStore.getState()
    zoom.beginZoomGesture()
    zoom.setZoomLevelImmediate(1.8)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    useZoomStore.getState().endZoomGesture()

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1.8,
      contentPixelsPerSecond: 180,
      isZoomInteracting: false,
    })
    expect(requestAnimationFrameMock).not.toHaveBeenCalled()
    expect(requestIdleCallbackMock).not.toHaveBeenCalled()
  })

  it('notifies committed-only subscribers once after a live zoom burst', () => {
    const settledNotifications = vi.fn()
    testUnsubscribers.push(useSettledZoomStore.subscribe(settledNotifications))

    useZoomStore.getState().setZoomLevelImmediate(1.2)
    useZoomStore.getState().setZoomLevelImmediate(1.6)

    expect(settledNotifications).not.toHaveBeenCalled()
    expect(useSettledZoomStore.getState()).toEqual({
      contentLevel: 1,
      contentPixelsPerSecond: 100,
    })

    vi.advanceTimersByTime(200)

    expect(settledNotifications).toHaveBeenCalledTimes(1)
    expect(useSettledZoomStore.getState()).toEqual({
      contentLevel: 1.6,
      contentPixelsPerSecond: 160,
    })

    useZoomStore.setState({
      contentLevel: 0.75,
      contentPixelsPerSecond: 75,
    })
    expect(settledNotifications).toHaveBeenCalledTimes(2)
    expect(useSettledZoomStore.getState()).toEqual({
      contentLevel: 0.75,
      contentPixelsPerSecond: 75,
    })

    _resetZoomStoreForTest()
    expect(settledNotifications).toHaveBeenCalledTimes(3)
    expect(useSettledZoomStore.getState()).toEqual({
      contentLevel: 1,
      contentPixelsPerSecond: 100,
    })
  })

  it('cancels and replaces playback-aware committed geometry work', () => {
    let nextId = 1
    const animationFrames = new Map<number, FrameRequestCallback>()
    const idleCallbacks = new Map<number, IdleRequestCallback>()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextId++
        animationFrames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => animationFrames.delete(id)),
    )
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        const id = nextId++
        idleCallbacks.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelIdleCallback',
      vi.fn((id: number) => idleCallbacks.delete(id)),
    )
    usePlaybackStore.setState({ isPlaying: true })
    const notifications = observeZoomNotifications()

    useZoomStore.getState().setZoomLevelImmediate(1.4)
    expect(notifications).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(useZoomStore.getState().contentLevel).toBe(1)
    expect(animationFrames.size).toBe(1)
    expect(notifications).toHaveLength(1)

    const firstFrame = animationFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    expect(firstFrame).toBeDefined()
    animationFrames.delete(firstFrame![0])
    firstFrame![1](100)
    expect(idleCallbacks.size).toBe(1)

    // A new wheel target invalidates the queued idle commit before it can wake
    // the rich timeline subtree.
    useZoomStore.getState().setZoomLevelImmediate(1.6)
    expect(idleCallbacks.size).toBe(0)
    expect(notifications).toHaveLength(2)
    vi.advanceTimersByTime(200)

    const finalFrame = animationFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    expect(finalFrame).toBeDefined()
    animationFrames.delete(finalFrame![0])
    finalFrame![1](200)
    const finalIdle = idleCallbacks.entries().next().value as
      | [number, IdleRequestCallback]
      | undefined
    expect(finalIdle).toBeDefined()
    idleCallbacks.delete(finalIdle![0])
    finalIdle![1]({ didTimeout: false, timeRemaining: () => 8 })

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1.6,
      contentPixelsPerSecond: 160,
      isZoomInteracting: false,
    })
    expect(notifications).toHaveLength(3)
    expect(notifications.every(hasChangedZoomValue)).toBe(true)
  })

  it('forces playback-aware wheel settle when the browser never grants idle time', () => {
    let nextId = 1
    const animationFrames = new Map<number, FrameRequestCallback>()
    const idleCallbacks = new Map<number, IdleRequestCallback>()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextId++
        animationFrames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => animationFrames.delete(id)),
    )
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        const id = nextId++
        idleCallbacks.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelIdleCallback',
      vi.fn((id: number) => idleCallbacks.delete(id)),
    )
    usePlaybackStore.setState({ isPlaying: true })

    useZoomStore.getState().setZoomLevelImmediate(1.6)
    vi.advanceTimersByTime(200)

    const frame = animationFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    expect(frame).toBeDefined()
    animationFrames.delete(frame![0])
    frame![1](100)
    expect(idleCallbacks.size).toBe(1)

    vi.advanceTimersByTime(199)
    expect(useZoomStore.getState().contentLevel).toBe(1)

    vi.advanceTimersByTime(1)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1.6,
      contentPixelsPerSecond: 160,
      isZoomInteracting: false,
    })
    expect(idleCallbacks.size).toBe(0)
  })

  it('applies discrete zoom actions synchronously to both visual and content zoom', () => {
    useZoomStore.getState().zoomIn()

    const state = useZoomStore.getState()
    expect(state.level).toBeCloseTo(1.1)
    expect(state.pixelsPerSecond).toBeCloseTo(110)
    expect(state.contentLevel).toBeCloseTo(1.1)
    expect(state.contentPixelsPerSecond).toBeCloseTo(110)
    expect(state.isZoomInteracting).toBe(false)
  })

  it('can synchronize a direct zoom level update without leaving content behind', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.8)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    useZoomStore.getState().setZoomLevelSynchronized(0.75)

    expect(useZoomStore.getState()).toMatchObject({
      level: 0.75,
      pixelsPerSecond: 75,
      contentLevel: 0.75,
      contentPixelsPerSecond: 75,
      isZoomInteracting: false,
    })

    vi.advanceTimersByTime(200)
    expect(useZoomStore.getState()).toMatchObject({
      level: 0.75,
      contentLevel: 0.75,
      isZoomInteracting: false,
    })
  })
})
