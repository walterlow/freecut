import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import {
  buildPowerWindowEffects,
  clampPowerWindowParams,
  derivePowerWindowDragParams,
  readPowerWindowParams,
  type PowerWindowParams,
} from './power-window-overlay-utils'

const baseParams: PowerWindowParams = {
  shape: 'ellipse',
  centerX: 0.5,
  centerY: 0.5,
  sizeX: 0.4,
  sizeY: 0.3,
  rotation: 0,
}

function makePowerWindowEffect(params: Partial<PowerWindowParams> = {}): ItemEffect {
  return {
    id: 'window-1',
    enabled: true,
    effect: {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-power-window',
      params: {
        ...baseParams,
        ...params,
        exposure: 0.25,
      },
    },
  }
}

describe('power window overlay helpers', () => {
  it('reads params with professional-safe defaults', () => {
    const effect = makePowerWindowEffect({ shape: 'rectangle', centerX: 0.25 })
    expect(readPowerWindowParams(effect)).toEqual({
      shape: 'rectangle',
      centerX: 0.25,
      centerY: 0.5,
      sizeX: 0.4,
      sizeY: 0.3,
      rotation: 0,
    })
  })

  it('clamps center and size to shader-supported ranges', () => {
    expect(
      clampPowerWindowParams({
        shape: 'ellipse',
        centerX: 1.5,
        centerY: -0.5,
        sizeX: 0,
        sizeY: 4,
        rotation: 12,
      }),
    ).toEqual({
      shape: 'ellipse',
      centerX: 1,
      centerY: 0,
      sizeX: 0.02,
      sizeY: 1.5,
      rotation: 12,
    })
  })

  it('moves the window center by pointer delta', () => {
    const params = derivePowerWindowDragParams(
      {
        handle: 'center',
        startParams: baseParams,
        startUv: { x: 0.5, y: 0.5 },
      },
      { x: 0.6, y: 0.45 },
    )
    expect(params.centerX).toBeCloseTo(0.6)
    expect(params.centerY).toBeCloseTo(0.45)
    expect(params.sizeX).toBe(0.4)
    expect(params.sizeY).toBe(0.3)
  })

  it('resizes symmetrically from side handles', () => {
    expect(
      derivePowerWindowDragParams(
        {
          handle: 'east',
          startParams: baseParams,
          startUv: { x: 0.7, y: 0.5 },
        },
        { x: 0.8, y: 0.5 },
      ).sizeX,
    ).toBeCloseTo(0.6)
  })

  it('resizes a rotated window in aspect-correct canvas space', () => {
    const params = derivePowerWindowDragParams(
      {
        handle: 'east',
        startParams: { ...baseParams, rotation: 45 },
        startUv: { x: 0.64142, y: 0.75142 },
      },
      { x: 0.71213, y: 0.87712 },
      { canvasAspectRatio: 16 / 9 },
    )

    expect(params.sizeX).toBeCloseTo(0.6, 4)
  })

  it('rotates around the window center with aspect-correct pointer math', () => {
    const params = derivePowerWindowDragParams(
      {
        handle: 'rotation',
        startParams: baseParams,
        startUv: { x: 0.5, y: 0.35 },
      },
      { x: 0.584375, y: 0.35 },
      { canvasAspectRatio: 16 / 9 },
    )

    expect(params.rotation).toBeCloseTo(45)
    expect(params.centerX).toBe(baseParams.centerX)
    expect(params.sizeX).toBe(baseParams.sizeX)
  })

  it('snaps rotation to 15 degree increments', () => {
    const params = derivePowerWindowDragParams(
      {
        handle: 'rotation',
        startParams: baseParams,
        startUv: { x: 0.5, y: 0.35 },
      },
      { x: 0.584375, y: 0.48423 },
      { canvasAspectRatio: 16 / 9, snapRotation: true },
    )

    expect(params.rotation).toBe(90)
  })

  it('updates only the target effect and preserves correction params', () => {
    const otherEffect: ItemEffect = {
      id: 'brightness-1',
      enabled: true,
      effect: { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: 0.2 } },
    }
    const updated = buildPowerWindowEffects([otherEffect, makePowerWindowEffect()], 'window-1', {
      ...baseParams,
      centerX: 0.75,
      shape: 'rectangle',
    })

    expect(updated[0]).toBe(otherEffect)
    expect(updated[1]?.effect.params).toMatchObject({
      shape: 'rectangle',
      centerX: 0.75,
      exposure: 0.25,
    })
  })
})
