// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetAutoKeyframeStore } from '@/features/preview/deps/keyframes'
import { useTransitionsStore } from '@/features/preview/deps/timeline-store'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { Transform } from '../types/gizmo'
import { buildGroupScaledTextProperties, buildGroupTextScaleCommit } from './group-text-scale'

const transform = (width: number, height: number): Transform => ({
  x: 0,
  y: 0,
  width,
  height,
  rotation: 0,
  opacity: 1,
})

describe('group text scale', () => {
  beforeEach(() => {
    resetAutoKeyframeStore()
    useTransitionsStore.getState().setTransitions([])
  })

  it('scales text metrics while leaving video content on the transform path', () => {
    const text = {
      id: 'text-1',
      type: 'text',
      trackId: 'text-track',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
      fontSize: 80,
      letterSpacing: 4,
      textPadding: 20,
      backgroundRadius: 12,
      textShadow: { offsetX: 2, offsetY: 6, blur: 10, color: '#000000' },
      stroke: { width: 2, color: '#000000' },
      textSpans: [{ text: 'Title', fontSize: 100, letterSpacing: 6 }],
    } as TextItem
    const video = {
      id: 'video-1',
      type: 'video',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 90,
      label: 'Video',
      src: 'video.mp4',
    } as VideoItem
    const start = new Map<string, Transform>([
      [text.id, transform(400, 200)],
      [video.id, transform(1280, 720)],
    ])
    const next = new Map<string, Transform>([
      [text.id, transform(200, 100)],
      [video.id, transform(640, 360)],
    ])

    const updates = buildGroupScaledTextProperties([text, video] as TimelineItem[], start, next)

    expect(updates.has(video.id)).toBe(false)
    expect(updates.get(text.id)).toMatchObject({
      fontSize: 40,
      letterSpacing: 2,
      textPadding: 10,
      backgroundRadius: 6,
      textShadow: { offsetX: 1, offsetY: 3, blur: 5 },
      stroke: { width: 1 },
      textSpans: [{ fontSize: 50, letterSpacing: 3 }],
    })
  })

  it('materializes resolved defaults so unstyled text scales visually', () => {
    const text = {
      id: 'text-defaults',
      type: 'text',
      trackId: 'text-track',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
    } as TextItem

    const updates = buildGroupScaledTextProperties(
      [text],
      new Map([[text.id, transform(300, 100)]]),
      new Map([[text.id, transform(450, 150)]]),
    )

    expect(updates.get(text.id)).toMatchObject({
      fontSize: 90,
      letterSpacing: 0,
      textPadding: 24,
      backgroundRadius: 0,
    })
  })

  it('moves scalable typography into keyframes when geometry is frame-scoped', () => {
    const text = {
      id: 'text-keyed-scale',
      type: 'text',
      trackId: 'text-track',
      from: 10,
      durationInFrames: 90,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
      fontSize: 80,
      letterSpacing: 4,
      textPadding: 20,
      backgroundRadius: 12,
      textStyleScale: 1,
      textShadow: { offsetX: 2, offsetY: 6, blur: 10, color: '#000000' },
      stroke: { width: 2, color: '#000000' },
      textSpans: [{ text: 'Title', fontSize: 100 }],
    } as TextItem
    const updates = buildGroupScaledTextProperties(
      [text],
      new Map([[text.id, transform(400, 200)]]),
      new Map([[text.id, transform(200, 100)]]),
    ).get(text.id)!

    const commit = buildGroupTextScaleCommit(text, undefined, updates, 25, true)

    expect(commit.autoKeyframeOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'fontSize', frame: 15, value: 40 }),
        expect.objectContaining({ property: 'textPadding', frame: 15, value: 10 }),
        expect.objectContaining({ property: 'backgroundRadius', frame: 15, value: 6 }),
        expect.objectContaining({ property: 'textStyleScale', frame: 15, value: 0.5 }),
        expect.objectContaining({ property: 'textShadowOffsetX', frame: 15, value: 1 }),
        expect.objectContaining({ property: 'textShadowOffsetY', frame: 15, value: 3 }),
        expect.objectContaining({ property: 'textShadowBlur', frame: 15, value: 5 }),
        expect.objectContaining({ property: 'strokeWidth', frame: 15, value: 1 }),
      ]),
    )
    expect(commit.itemUpdates).toEqual({
      letterSpacing: 2,
      textSpans: [{ text: 'Title', fontSize: 50 }],
    })
  })

  it('updates an existing typography lane instead of writing its base value', () => {
    const text = {
      id: 'text-animated-font',
      type: 'text',
      trackId: 'text-track',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
      fontSize: 80,
    } as TextItem
    const keyframes: ItemKeyframes = {
      itemId: text.id,
      properties: [
        {
          property: 'fontSize',
          keyframes: [{ id: 'font-kf', frame: 20, value: 120, easing: 'linear' }],
        },
      ],
    }
    const updates = buildGroupScaledTextProperties(
      [{ ...text, fontSize: 120 }],
      new Map([[text.id, transform(400, 200)]]),
      new Map([[text.id, transform(200, 100)]]),
    ).get(text.id)!

    const commit = buildGroupTextScaleCommit(text, keyframes, updates, 20, false)

    expect(commit.autoKeyframeOperations).toContainEqual({
      type: 'update',
      itemId: text.id,
      property: 'fontSize',
      keyframeId: 'font-kf',
      updates: { value: 60 },
    })
    expect(commit.itemUpdates).not.toHaveProperty('fontSize')
  })
})
