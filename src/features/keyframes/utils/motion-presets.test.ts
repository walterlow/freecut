import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import {
  AUTO_CAMERA_SEQUENCE,
  CAMERA_MOTION_PRESETS,
  CINEMATIC_STORY_CAMERA_SEQUENCE,
  COMPOUND_PARALLAX_CAMERA_SEQUENCE,
  MOTION_PRESETS,
  MOTION_PRESETS_BY_ID,
  getMotionPresetAnchorFrame,
  pickAutoCameraPresetId,
  pickCinematicStoryCameraPresetId,
  pickCompoundParallaxCameraPresetId,
  type MotionPresetBuildContext,
} from './motion-presets'

const anchor: ResolvedTransform = {
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  anchorX: 200,
  anchorY: 150,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

function ctx(overrides: Partial<MotionPresetBuildContext> = {}): MotionPresetBuildContext {
  return {
    anchor,
    durationInFrames: 90,
    fps: 30,
    frameWidth: 1920,
    frameHeight: 1080,
    ...overrides,
  }
}

describe('motion presets', () => {
  it('has a unique, complete id catalog', () => {
    const ids = MOTION_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(MOTION_PRESETS_BY_ID).length).toBe(MOTION_PRESETS.length)
  })

  it('every preset only writes the properties it declares', () => {
    for (const preset of MOTION_PRESETS) {
      const written = new Set(preset.build(ctx()).map((k) => k.property))
      for (const property of written) {
        expect(preset.properties).toContain(property)
      }
    }
  })

  it('produces no keyframes for degenerate single-frame clips', () => {
    for (const preset of MOTION_PRESETS) {
      expect(preset.build(ctx({ durationInFrames: 1 }))).toEqual([])
    }
  })

  it('keeps every keyframe within the clip bounds', () => {
    for (const preset of MOTION_PRESETS) {
      for (const k of preset.build(ctx())) {
        expect(k.frame).toBeGreaterThanOrEqual(0)
        expect(k.frame).toBeLessThanOrEqual(89)
      }
    }
  })

  it('fade-in ramps opacity from 0 to the resting value', () => {
    const keys = MOTION_PRESETS_BY_ID['fade-in'].build(ctx())
    expect(keys[0]).toMatchObject({ property: 'opacity', frame: 0, value: 0 })
    expect(keys.at(-1)).toMatchObject({ property: 'opacity', value: anchor.opacity })
  })

  it('entrance presets settle on the resting transform', () => {
    const keys = MOTION_PRESETS_BY_ID['slide-in-left'].build(ctx())
    const xKeys = keys.filter((k) => k.property === 'x')
    expect(xKeys[0]!.value).toBeLessThan(anchor.x)
    expect(xKeys.at(-1)!.value).toBe(anchor.x)
  })

  it('exit presets start at the resting transform and leave', () => {
    const keys = MOTION_PRESETS_BY_ID['fade-out'].build(ctx())
    expect(keys[0]).toMatchObject({ value: anchor.opacity })
    expect(keys.at(-1)).toMatchObject({ value: 0 })
  })

  it('anchors entrance at the end of its window and exit before it leaves', () => {
    expect(getMotionPresetAnchorFrame('entrance', 90, 30)).toBe(15)
    expect(getMotionPresetAnchorFrame('exit', 90, 30)).toBe(89 - 15)
    expect(getMotionPresetAnchorFrame('emphasis', 90, 30)).toBe(0)
    expect(getMotionPresetAnchorFrame('camera', 90, 30)).toBe(0)
  })
})

describe('camera presets', () => {
  it('ships the full 60-move cinematic catalog', () => {
    expect(CAMERA_MOTION_PRESETS.length).toBe(60)
    for (const preset of CAMERA_MOTION_PRESETS) {
      expect(preset.category).toBe('camera')
    }
  })

  it('runs every move across the full clip (first and last frame)', () => {
    for (const preset of CAMERA_MOTION_PRESETS) {
      const frames = preset.build(ctx()).map((k) => k.frame)
      expect(Math.min(...frames)).toBe(0)
      expect(Math.max(...frames)).toBe(89)
    }
  })

  it('push-in ends scaled up from rest; pull-back settles back at rest', () => {
    const pushIn = MOTION_PRESETS_BY_ID['push-in'].build(ctx())
    const widthKeys = pushIn.filter((k) => k.property === 'width')
    expect(widthKeys[0]!.value).toBe(anchor.width)
    expect(widthKeys.at(-1)!.value).toBeCloseTo(anchor.width * 1.12)

    const pullBack = MOTION_PRESETS_BY_ID['pull-back'].build(ctx())
    const pullWidth = pullBack.filter((k) => k.property === 'width')
    expect(pullWidth[0]!.value).toBeCloseTo(anchor.width * 1.12)
    expect(pullWidth.at(-1)!.value).toBe(anchor.width)
  })

  it('pans carry a locked cover zoom so the image edge is never revealed', () => {
    const keys = MOTION_PRESETS_BY_ID['pan-left'].build(ctx())
    const widthKeys = keys.filter((k) => k.property === 'width')
    expect(widthKeys[0]!.value).toBeCloseTo(anchor.width * 1.12)
    expect(widthKeys.at(-1)!.value).toBeCloseTo(anchor.width * 1.12)
    const xKeys = keys.filter((k) => k.property === 'x')
    expect(xKeys[0]!.value).toBeGreaterThan(xKeys.at(-1)!.value)
  })

  it('staged moves push in before the secondary pan or tilt', () => {
    const keys = MOTION_PRESETS_BY_ID['stage-push-tilt-down'].build(ctx())
    const widthKeys = keys.filter((k) => k.property === 'width')
    const yKeys = keys.filter((k) => k.property === 'y')

    expect(widthKeys.map((k) => k.frame)).toEqual([0, 40, 89])
    expect(yKeys.map((k) => k.frame)).toEqual([0, 40, 89])
    expect(widthKeys[0]!.value).toBeGreaterThan(anchor.width)
    expect(widthKeys[1]!.value).toBeGreaterThan(widthKeys[0]!.value)
    expect(widthKeys[2]!.value).toBeGreaterThan(widthKeys[1]!.value)
    expect(yKeys[0]!.value).toBe(anchor.y)
    expect(yKeys[1]!.value).toBe(anchor.y)
    expect(yKeys[2]!.value).toBeGreaterThan(anchor.y)
  })

  it('surge moves keep zoom, pan, and tilt active through the full shot', () => {
    const keys = MOTION_PRESETS_BY_ID['surge-down-right'].build(ctx())
    const widthKeys = keys.filter((k) => k.property === 'width')
    const xKeys = keys.filter((k) => k.property === 'x')
    const yKeys = keys.filter((k) => k.property === 'y')

    expect(widthKeys.map((k) => k.frame)).toEqual([0, 27, 89])
    expect(xKeys.map((k) => k.frame)).toEqual([0, 27, 89])
    expect(yKeys.map((k) => k.frame)).toEqual([0, 27, 89])
    expect(widthKeys[0]!.value).toBeGreaterThan(anchor.width)
    expect(widthKeys[1]!.value).toBeGreaterThan(widthKeys[0]!.value)
    expect(widthKeys[2]!.value).toBeGreaterThan(widthKeys[1]!.value)
    expect(widthKeys[2]!.value).toBeGreaterThanOrEqual(anchor.width * 1.36)
    expect(xKeys.at(-1)!.value - xKeys[0]!.value).toBeGreaterThanOrEqual(210)
    expect(yKeys.at(-1)!.value - yKeys[0]!.value).toBeGreaterThanOrEqual(108)
    expect(xKeys[0]!.value).toBeLessThan(xKeys[1]!.value)
    expect(xKeys[1]!.value).toBeLessThan(xKeys[2]!.value)
    expect(yKeys[0]!.value).toBeLessThan(yKeys[1]!.value)
    expect(yKeys[1]!.value).toBeLessThan(yKeys[2]!.value)
  })

  it('handheld starts and ends at rest', () => {
    const keys = MOTION_PRESETS_BY_ID['handheld'].build(ctx())
    const xKeys = keys.filter((k) => k.property === 'x')
    expect(xKeys[0]!.value).toBe(anchor.x)
    expect(xKeys.at(-1)!.value).toBe(anchor.x)
  })

  it('auto rotation only references camera presets and wraps around', () => {
    for (const id of AUTO_CAMERA_SEQUENCE) {
      expect(MOTION_PRESETS_BY_ID[id]!.category).toBe('camera')
    }
    expect(pickAutoCameraPresetId(0)).toBe(AUTO_CAMERA_SEQUENCE[0])
    expect(pickAutoCameraPresetId(AUTO_CAMERA_SEQUENCE.length)).toBe(AUTO_CAMERA_SEQUENCE[0])
    expect(pickAutoCameraPresetId(-1)).toBe(AUTO_CAMERA_SEQUENCE.at(-1))
  })

  it('cinematic story rotation uses multi-axis camera moves and wraps around', () => {
    for (const id of CINEMATIC_STORY_CAMERA_SEQUENCE) {
      const preset = MOTION_PRESETS_BY_ID[id]!
      expect(preset.category).toBe('camera')
      const animatedProperties = new Set(preset.build(ctx()).map((keyframe) => keyframe.property))
      expect(animatedProperties.size).toBeGreaterThanOrEqual(2)
      expect(animatedProperties.has('width') || animatedProperties.has('height')).toBe(true)
    }
    expect(pickCinematicStoryCameraPresetId(0)).toBe('surge-down-right')
    expect(pickCinematicStoryCameraPresetId(1)).toBe('surge-up-left')
    expect(pickCinematicStoryCameraPresetId(CINEMATIC_STORY_CAMERA_SEQUENCE.length)).toBe(
      CINEMATIC_STORY_CAMERA_SEQUENCE[0],
    )
    expect(pickCinematicStoryCameraPresetId(-1)).toBe(CINEMATIC_STORY_CAMERA_SEQUENCE.at(-1))
  })

  it('compound parallax keeps zoom and one direction moving for the full shot', () => {
    for (const id of COMPOUND_PARALLAX_CAMERA_SEQUENCE) {
      const keys = MOTION_PRESETS_BY_ID[id]!.build(ctx())
      const widthKeys = keys.filter((keyframe) => keyframe.property === 'width')
      const directionKeys = keys.filter(
        (keyframe) => keyframe.property === 'x' || keyframe.property === 'y',
      )

      expect(widthKeys.map((keyframe) => keyframe.frame)).toEqual([0, 89])
      expect(directionKeys.map((keyframe) => keyframe.frame)).toEqual([0, 89])
      expect(widthKeys[0]!.value).not.toBe(widthKeys[1]!.value)
      expect(directionKeys[0]!.value).not.toBe(directionKeys[1]!.value)
    }
    expect(pickCompoundParallaxCameraPresetId(0)).toBe('compound-push-pan-right')
    expect(pickCompoundParallaxCameraPresetId(COMPOUND_PARALLAX_CAMERA_SEQUENCE.length)).toBe(
      COMPOUND_PARALLAX_CAMERA_SEQUENCE[0],
    )
  })
})
