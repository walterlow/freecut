import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import { resolveAnimatedTransform } from './animated-transform-resolver'

describe('resolveAnimatedTransform', () => {
  it('interpolates anchor keyframes alongside the base transform', () => {
    const baseTransform = {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      anchorX: 160,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    const itemKeyframes: ItemKeyframes = {
      itemId: 'video-1',
      properties: [
        {
          property: 'anchorX',
          keyframes: [
            { id: 'ax-1', frame: 0, value: 40, easing: 'linear' },
            { id: 'ax-2', frame: 10, value: 140, easing: 'linear' },
          ],
        },
        {
          property: 'anchorY',
          keyframes: [
            { id: 'ay-1', frame: 0, value: 30, easing: 'linear' },
            { id: 'ay-2', frame: 10, value: 110, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedTransform(baseTransform, itemKeyframes, 5)

    expect(resolved.anchorX).toBe(90)
    expect(resolved.anchorY).toBe(70)
    expect(resolved.width).toBe(320)
    expect(resolved.height).toBe(180)
  })
})
