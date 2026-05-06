import { describe, expect, it } from 'vite-plus/test'
import {
  AUDIO_FADE_CURVE_X_MIN,
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
} from '@/shared/utils/audio-fade-curve'
import { getAudioFadeCurveControlPoint, getAudioFadeCurveFromOffset } from './audio-fade-curve'

describe('timeline audio-fade-curve', () => {
  it('moves the control point above or below the linear midpoint based on curve', () => {
    const linear = getAudioFadeCurveControlPoint({
      handle: 'in',
      fadePixels: 40,
      clipWidthPixels: 120,
      curve: 0,
      curveX: 0.52,
    })
    const curvedUp = getAudioFadeCurveControlPoint({
      handle: 'in',
      fadePixels: 40,
      clipWidthPixels: 120,
      curve: 0.6,
      curveX: 0.52,
    })
    const curvedDown = getAudioFadeCurveControlPoint({
      handle: 'in',
      fadePixels: 40,
      clipWidthPixels: 120,
      curve: -0.6,
      curveX: 0.52,
    })

    expect(curvedUp.y).toBeLessThan(linear.y)
    expect(curvedDown.y).toBeGreaterThan(linear.y)
  })

  it('keeps the draggable point on the rendered fade profile', () => {
    const fadeInPoint = getAudioFadeCurveControlPoint({
      handle: 'in',
      fadePixels: 40,
      clipWidthPixels: 120,
      curve: 0.8,
      curveX: 0.25,
    })
    const fadeOutPoint = getAudioFadeCurveControlPoint({
      handle: 'out',
      fadePixels: 40,
      clipWidthPixels: 120,
      curve: -0.8,
      curveX: 0.75,
    })

    expect(fadeInPoint.x).toBeCloseTo(10, 5)
    expect(fadeInPoint.y).toBeCloseTo(100 - evaluateAudioFadeInCurve(0.25, 0.8, 0.25) * 100, 5)
    expect(fadeOutPoint.x).toBeCloseTo(110, 5)
    expect(fadeOutPoint.y).toBeCloseTo(100 - evaluateAudioFadeOutCurve(0.75, -0.8, 0.75) * 100, 5)
  })

  it('maps pointer offsets back into a clamped curve value', () => {
    expect(
      getAudioFadeCurveFromOffset({
        handle: 'in',
        pointerOffsetX: 20,
        pointerOffsetY: 0,
        fadePixels: 40,
        clipWidthPixels: 120,
        rowHeight: 40,
      }).curve,
    ).toBeGreaterThan(0)
    expect(
      getAudioFadeCurveFromOffset({
        handle: 'in',
        pointerOffsetX: 20,
        pointerOffsetY: 40,
        fadePixels: 40,
        clipWidthPixels: 120,
        rowHeight: 40,
      }).curve,
    ).toBeLessThan(0)
    const neutral = getAudioFadeCurveFromOffset({
      handle: 'in',
      pointerOffsetX: 20,
      pointerOffsetY: 20,
      fadePixels: 40,
      clipWidthPixels: 120,
      rowHeight: 40,
    })
    expect(neutral.curve).toBeCloseTo(0, 1)
    expect(neutral.curveX).toBeCloseTo(0.5, 1)
  })

  it('snaps curveX to the clamped edge but still follows pointer Y', () => {
    const topLeft = getAudioFadeCurveFromOffset({
      handle: 'in',
      pointerOffsetX: -40,
      pointerOffsetY: 0,
      fadePixels: 40,
      clipWidthPixels: 120,
      rowHeight: 40,
    })
    const bottomLeft = getAudioFadeCurveFromOffset({
      handle: 'in',
      pointerOffsetX: -40,
      pointerOffsetY: 40,
      fadePixels: 40,
      clipWidthPixels: 120,
      rowHeight: 40,
    })

    expect(topLeft.curveX).toBe(AUDIO_FADE_CURVE_X_MIN)
    expect(bottomLeft.curveX).toBe(AUDIO_FADE_CURVE_X_MIN)
    expect(topLeft.curve).toBeGreaterThan(0)
    expect(bottomLeft.curve).toBeLessThan(topLeft.curve)
  })

  it('snaps curveX near the edge but curve varies with Y', () => {
    const nearLeftTop = getAudioFadeCurveFromOffset({
      handle: 'in',
      pointerOffsetX: 4,
      pointerOffsetY: 0,
      fadePixels: 40,
      clipWidthPixels: 120,
      rowHeight: 40,
    })
    const nearLeftBottom = getAudioFadeCurveFromOffset({
      handle: 'in',
      pointerOffsetX: 4,
      pointerOffsetY: 40,
      fadePixels: 40,
      clipWidthPixels: 120,
      rowHeight: 40,
    })

    expect(nearLeftTop.curveX).toBe(AUDIO_FADE_CURVE_X_MIN)
    expect(nearLeftBottom.curveX).toBe(AUDIO_FADE_CURVE_X_MIN)
    expect(nearLeftTop.curve).not.toEqual(nearLeftBottom.curve)
  })
})
