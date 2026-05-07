import * as React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render } from '@testing-library/react'

const getClipElementMock = vi.fn()
const onFrameChangeMock = vi.fn(() => vi.fn())
const clockMock = {
  currentFrame: 0,
  onFrameChange: onFrameChangeMock,
}
let isPlayingMock = true

vi.mock('@/features/composition-runtime/deps/player', () => ({
  useClock: () => clockMock,
  useVideoSourcePool: () => ({ getClipElement: getClipElementMock }),
}))

vi.mock('./use-player-compat', () => ({
  useIsPlaying: () => isPlayingMock,
}))

import {
  getTransitionSyncPlaybackRate,
  useTransitionParticipantSync,
  type TransitionSyncParticipant,
} from './use-transition-participant-sync'

function SyncHarness({
  participants,
  groupMinFrom,
  timelineFps,
}: {
  participants: TransitionSyncParticipant[]
  groupMinFrom: number
  timelineFps: number
}) {
  useTransitionParticipantSync(participants, groupMinFrom, timelineFps)
  return null
}

const createVideo = (overrides: Partial<HTMLVideoElement> = {}) => {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    duration: { configurable: true, value: overrides.duration ?? 100 },
    paused: { configurable: true, writable: true, value: overrides.paused ?? false },
    readyState: { configurable: true, value: overrides.readyState ?? 4 },
  })
  video.currentTime = overrides.currentTime ?? 0
  video.playbackRate = overrides.playbackRate ?? 1
  video.pause = vi.fn(() => {
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
  })
  video.play = vi.fn(() => Promise.resolve())
  return video
}

describe('getTransitionSyncPlaybackRate', () => {
  it('keeps the leader on the nominal playback rate', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.04, 'leader')).toBe(1)
  })

  it('slows down a follower when it is ahead of the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.08, 'follower')).toBeLessThan(1)
  })

  it('speeds up a follower when it is behind the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, -0.08, 'follower')).toBeGreaterThan(1)
  })

  it('clamps follower correction to a bounded range', () => {
    expect(getTransitionSyncPlaybackRate(1, 10, 'follower')).toBeGreaterThanOrEqual(0.94)
    expect(getTransitionSyncPlaybackRate(1, -10, 'follower')).toBeLessThanOrEqual(1.06)
  })
})

describe('useTransitionParticipantSync', () => {
  beforeEach(() => {
    clockMock.currentFrame = 10
    getClipElementMock.mockReset()
    onFrameChangeMock.mockClear()
    isPlayingMock = true
  })

  it('does not pause or seek premount participants held by a transition session', () => {
    clockMock.currentFrame = 20
    const heldVideo = createVideo({ currentTime: 1.5, paused: false })
    heldVideo.dataset.transitionHold = '1'
    const freeVideo = createVideo({ currentTime: 1.5, paused: false })
    getClipElementMock.mockImplementation((clipId: string) =>
      clipId === 'held' ? heldVideo : freeVideo,
    )

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'held',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 20,
            role: 'leader',
          },
          {
            poolClipId: 'free',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 20,
            role: 'follower',
          },
        ],
        groupMinFrom: 10,
        timelineFps: 30,
      }),
    )

    expect(heldVideo.pause).not.toHaveBeenCalled()
    expect(heldVideo.currentTime).toBe(1.5)
    expect(freeVideo.pause).toHaveBeenCalledTimes(1)
    expect(freeVideo.currentTime).toBe(2)
  })

  it('syncs participants against source-native FPS and per-item sequence offsets', () => {
    clockMock.currentFrame = 25
    const leader = createVideo({ currentTime: 0, paused: true })
    const follower = createVideo({ currentTime: 0, paused: true })
    getClipElementMock.mockImplementation((clipId: string) =>
      clipId === 'leader' ? leader : follower,
    )

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'leader',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 0,
            role: 'leader',
          },
          {
            poolClipId: 'follower',
            safeTrimBefore: 120,
            sourceFps: 60,
            playbackRate: 1,
            sequenceFrameOffset: 10,
            role: 'follower',
          },
        ],
        groupMinFrom: 10,
        timelineFps: 30,
      }),
    )

    expect(leader.currentTime).toBeCloseTo(2.5)
    expect(follower.currentTime).toBeCloseTo(2 + 5 / 30)
    expect(leader.play).toHaveBeenCalledTimes(1)
    expect(follower.play).toHaveBeenCalledTimes(1)
  })
})
