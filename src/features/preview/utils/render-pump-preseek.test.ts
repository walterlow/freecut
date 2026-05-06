import { describe, expect, it } from 'vite-plus/test'

/** Compare Map<string, number[]> values with floating-point tolerance. */
function expectMapCloseTo(
  actual: Map<string, number[]>,
  expected: Map<string, number[]>,
  precision = 4,
) {
  expect(actual.size).toBe(expected.size)
  for (const [key, expectedValues] of expected) {
    const actualValues = actual.get(key)
    expect(actualValues).toBeDefined()
    expect(actualValues!.length).toBe(expectedValues.length)
    for (let i = 0; i < expectedValues.length; i++) {
      expect(actualValues![i]).toBeCloseTo(expectedValues[i]!, precision)
    }
  }
}
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import {
  collectClipVideoSourceTimesBySrcForFrame,
  collectClipVideoSourceTimesBySrcForFrameRange,
  collectPlaybackStartVariableSpeedPreseekTargets,
  collectPlaybackStartVariableSpeedPrewarmItemIds,
  collectVisibleTrackVideoSourceTimesBySrc,
  getVideoItemSourceTimeSeconds,
  resolvePausedVariableSpeedPrewarmPlan,
} from './render-pump-preseek'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    trackId: 'track-1',
    type: 'video',
    label: 'Video',
    src: 'clip-a.mp4',
    from: 10,
    durationInFrames: 30,
    sourceStart: 120,
    sourceFps: 60,
    speed: 2,
    ...overrides,
  }
}

function makeTrack(items: VideoItem[]): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }
}

describe('render pump preseek helpers', () => {
  it('computes source time at a timeline frame', () => {
    const item = makeVideoItem({
      from: 10,
      sourceStart: 120,
      sourceFps: 60,
      speed: 2,
    })

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).toBeCloseTo(2.4)
  })

  it('requires explicit source fps when requested', () => {
    const item = makeVideoItem({ sourceFps: undefined })

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).not.toBeNull()
    expect(
      getVideoItemSourceTimeSeconds(item, 16, 30, {
        requireExplicitSourceFps: true,
      }),
    ).toBeNull()
  })

  it('groups visible video source times by src', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'a',
          src: 'same.mp4',
          from: 0,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
        }),
        makeVideoItem({
          id: 'b',
          src: 'same.mp4',
          from: 0,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 30,
          sourceFps: 30,
        }),
        makeVideoItem({
          id: 'c',
          src: 'other.mp4',
          from: 30,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
        }),
      ]),
    ]

    expectMapCloseTo(
      collectVisibleTrackVideoSourceTimesBySrc(tracks, 10, 30),
      new Map([['same.mp4', [10 / 30, 40 / 30]]]),
    )
  })

  it('collects transition clip source times for a frame range', () => {
    const items = [
      makeVideoItem({
        id: 'left',
        src: 'left.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 0,
        sourceFps: 30,
        speed: 1,
      }),
      makeVideoItem({
        id: 'right',
        src: 'right.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 90,
        sourceFps: 30,
        speed: 1,
      }),
    ]

    expectMapCloseTo(
      collectClipVideoSourceTimesBySrcForFrameRange(items, 40, 3, 30, {
        requireExplicitSourceFps: true,
      }),
      new Map([
        ['left.mp4', [0, 1 / 30, 2 / 30]],
        ['right.mp4', [3, 3 + 1 / 30, 3 + 2 / 30]],
      ]),
    )
  })

  it('collects transition clip source times for a single frame', () => {
    const items = [
      makeVideoItem({
        id: 'left',
        src: 'left.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 0,
        sourceFps: 30,
        speed: 1,
      }),
      makeVideoItem({
        id: 'right',
        src: 'right.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 60,
        sourceFps: 30,
        speed: 1,
      }),
    ]

    expectMapCloseTo(
      collectClipVideoSourceTimesBySrcForFrame(items, 41, 30, {
        requireExplicitSourceFps: true,
      }),
      new Map([
        ['left.mp4', [1 / 30]],
        ['right.mp4', [60 / 30 + 1 / 30]],
      ]),
    )
  })

  it('collects variable-speed playback-start prewarm ids and preseek targets', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'start-near',
          from: 100,
          durationInFrames: 60,
          speed: 1.5,
          sourceStart: 0,
          sourceFps: 30,
          src: 'near.mp4',
        }),
        makeVideoItem({
          id: 'already-running',
          from: 90,
          durationInFrames: 60,
          speed: 1.5,
          sourceStart: 0,
          sourceFps: 30,
          src: 'running.mp4',
        }),
        makeVideoItem({
          id: 'normal-speed',
          from: 100,
          durationInFrames: 60,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
          src: 'normal.mp4',
        }),
      ]),
    ]

    expect(collectPlaybackStartVariableSpeedPrewarmItemIds(tracks, 101)).toEqual(['start-near'])

    expect(collectPlaybackStartVariableSpeedPreseekTargets(tracks, 101, 30, 90)).toEqual([
      { src: 'near.mp4', time: 2.95 },
      { src: 'running.mp4', time: 2.95 },
    ])
  })

  it('resolves paused variable-speed prewarm visibility and preseek frame', () => {
    const tracks = [
      {
        ...makeTrack([
          makeVideoItem({
            id: 'occluder',
            from: 95,
            durationInFrames: 20,
            speed: 1,
            sourceStart: 0,
            sourceFps: 30,
            src: 'top.mp4',
          }),
        ]),
        id: 'top',
        order: 0,
      },
      {
        ...makeTrack([
          makeVideoItem({
            id: 'var-speed',
            from: 110,
            durationInFrames: 40,
            speed: 1.5,
            sourceStart: 0,
            sourceFps: 30,
            src: 'bottom.mp4',
          }),
        ]),
        id: 'bottom',
        order: 1,
      },
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toEqual({
      itemIds: ['var-speed'],
      visibilityFrame: 115,
      preseekFrame: 114,
    })
  })

  it('returns null when there are no paused variable-speed candidates', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'normal',
          from: 110,
          durationInFrames: 40,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
          src: 'normal.mp4',
        }),
      ]),
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toBeNull()
  })
})
