import { describe, expect, it } from 'vite-plus/test'
import {
  colorStringToKeyframeValue,
  interpolateColorKeyframeValue,
  keyframeValueToHexColor,
  normalizeHexColor,
} from './color-keyframes'
import type { Keyframe } from '@/types/keyframe'

describe('color keyframes', () => {
  it('normalizes editable hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('2E6B8C')).toBe('#2e6b8c')
    expect(normalizeHexColor('#123456ff')).toBe('#123456')
    expect(normalizeHexColor('oklch(70% 0.1 200)')).toBeNull()
  })

  it('round-trips colors through packed keyframe values', () => {
    expect(colorStringToKeyframeValue('#2e6b8c')).toBe(0x2e6b8c)
    expect(keyframeValueToHexColor(0x2e6b8c)).toBe('#2e6b8c')
  })

  it('interpolates RGB channels with the keyframe easing', () => {
    const keyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: 0xff0000, easing: 'linear' },
      { id: 'kf-2', frame: 10, value: 0x00ff00, easing: 'linear' },
    ]

    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 5, 0))).toBe('#808000')
  })
})
