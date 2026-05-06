import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import { getCropPropertyValue, resolveAnimatedCrop } from './animated-crop-resolver'

describe('resolveAnimatedCrop', () => {
  it('interpolates crop edge and softness keyframes in pixel space', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'video-1',
      properties: [
        {
          property: 'cropLeft',
          keyframes: [
            { id: 'left-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'left-2', frame: 10, value: 384, easing: 'linear' },
          ],
        },
        {
          property: 'cropSoftness',
          keyframes: [
            { id: 'soft-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'soft-2', frame: 10, value: 54, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedCrop(undefined, itemKeyframes, 5, {
      width: 1920,
      height: 1080,
    })

    expect(resolved?.left).toBeCloseTo(0.1)
    expect(resolved?.softness).toBeCloseTo(0.025)
    expect(getCropPropertyValue(resolved, 'cropLeft', { width: 1920, height: 1080 })).toBeCloseTo(
      192,
    )
    expect(
      getCropPropertyValue(resolved, 'cropSoftness', { width: 1920, height: 1080 }),
    ).toBeCloseTo(27)
  })
})
