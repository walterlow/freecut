import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import {
  MOTION_PRESETS,
  MOTION_PRESETS_BY_ID,
  getMotionPresetAnchorFrame,
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
  })
})
