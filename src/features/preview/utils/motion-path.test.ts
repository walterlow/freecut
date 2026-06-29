import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { buildMotionPathPoints, canvasPointToMotionPathScreenPoint } from './motion-path'

const canvas = { width: 1920, height: 1080, fps: 30 }

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 10,
    durationInFrames: 50,
    label: 'Clip',
    src: 'clip.mp4',
    transform: {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
    },
    ...overrides,
  } as TimelineItem
}

describe('motion path utilities', () => {
  it('returns no path without x or y keyframes', () => {
    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: {
        itemId: 'clip-1',
        properties: [
          {
            property: 'opacity',
            keyframes: [{ id: 'kf-1', frame: 0, value: 1, easing: 'linear' }],
          },
        ],
      },
      canvas,
    })

    expect(points).toEqual([])
  })

  it('samples the clip span and preserves exact position keyframe frames', () => {
    const keyframes: ItemKeyframes = {
      itemId: 'clip-1',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 17, value: 120, easing: 'linear' },
            { id: 'kf-3', frame: 49, value: 240, easing: 'linear' },
          ],
        },
      ],
    }

    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: keyframes,
      canvas,
      maxSamples: 4,
    })

    expect(points.map((point) => point.frame)).toEqual([10, 26, 27, 43, 59])
    expect(points.filter((point) => point.isKeyframe).map((point) => point.frame)).toEqual([
      10, 27, 59,
    ])
    expect(points[0]).toMatchObject({ x: 960, y: 540 })
    expect(points.at(-1)).toMatchObject({ x: 1200, y: 540 })
  })

  it('draws a path from a position-driving motion modifier without keyframes', () => {
    const points = buildMotionPathPoints({
      item: item({
        motionModifiers: [
          {
            id: 'mod-1',
            type: 'float-drift',
            enabled: true,
            amplitude: 1,
            frequency: 0.625,
            phaseFrames: 0,
            seed: 1,
          },
        ],
      }),
      itemKeyframes: undefined,
      canvas,
    })

    // Drift moves the clip, so the sampled span is a non-empty path with no
    // discrete keyframe markers.
    expect(points.length).toBeGreaterThan(0)
    expect(points.every((point) => point.isKeyframe === false)).toBe(true)
  })

  it('suppresses static position keyframes', () => {
    const points = buildMotionPathPoints({
      item: item(),
      itemKeyframes: {
        itemId: 'clip-1',
        properties: [
          {
            property: 'y',
            keyframes: [
              { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-2', frame: 49, value: 0, easing: 'linear' },
            ],
          },
        ],
      },
      canvas,
    })

    expect(points).toEqual([])
  })

  it('converts canvas points to player-space screen points', () => {
    const screenPoint = canvasPointToMotionPathScreenPoint(
      { frame: 10, x: 960, y: 540, isKeyframe: true },
      {
        containerRect: new DOMRect(0, 0, 960, 540),
        playerSize: { width: 960, height: 540 },
        projectSize: { width: 1920, height: 1080 },
        zoom: -1,
      },
    )

    expect(screenPoint).toMatchObject({ screenX: 480, screenY: 270 })
  })
})
