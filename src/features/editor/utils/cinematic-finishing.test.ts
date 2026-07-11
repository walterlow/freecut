import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import {
  buildCinematicFinishingEffectStack,
  buildCinematicFinishingUpdates,
  shouldApplyCinematicFinishing,
} from './cinematic-finishing'

function effect(
  id: string,
  gpuEffectType: string,
  params: Record<string, number> = {},
): ItemEffect {
  return {
    id,
    enabled: true,
    effect: { type: 'gpu-effect', gpuEffectType, params },
  }
}

describe('cinematic finishing', () => {
  it('adds lifted grade, sharpen, and subtle grain to an ungraded clip', () => {
    let index = 0
    const next = buildCinematicFinishingEffectStack([], () => String(++index))

    expect(next.map((entry) => entry.effect.gpuEffectType)).toEqual([
      'gpu-color-wheels',
      'gpu-sharpen',
      'gpu-grain',
    ])
    expect(next[0]?.effect.params).toMatchObject({
      lift: 0.032,
      shadows: 12,
      contrast: 1.05,
    })
    expect(next.every((entry) => entry.id.startsWith('cinematic-finish:'))).toBe(true)
  })

  it('preserves manual grades and avoids duplicate sharpening texture effects', () => {
    const manualGrade = effect('manual-grade', 'gpu-color-wheels', { exposure: -0.2 })
    const manualSharpen = effect('manual-sharpen', 'gpu-sharpen', { amount: 1.2 })
    const next = buildCinematicFinishingEffectStack([manualGrade, manualSharpen], () => 'auto')

    expect(next).toContain(manualGrade)
    expect(next).toContain(manualSharpen)
    expect(next.filter((entry) => entry.effect.gpuEffectType === 'gpu-color-wheels')).toHaveLength(
      1,
    )
    expect(next.filter((entry) => entry.effect.gpuEffectType === 'gpu-sharpen')).toHaveLength(1)
    expect(next.filter((entry) => entry.effect.gpuEffectType === 'gpu-grain')).toHaveLength(1)
  })

  it('uses a restrained neutral finish for studio documentaries', () => {
    const next = buildCinematicFinishingEffectStack([], () => 'doc', 'documentary')

    expect(next[0]?.effect.params).toMatchObject({
      lift: 0.018,
      saturation: -2,
      contrast: 1.025,
    })
    expect(next[1]?.effect.params).toMatchObject({ amount: 0.5 })
  })

  it('uses a sharp lifted Magnates finish with restrained texture', () => {
    const next = buildCinematicFinishingEffectStack([], () => 'magnates', 'magnates-3d')

    expect(next.map((entry) => entry.effect.gpuEffectType)).toEqual([
      'gpu-color-wheels',
      'gpu-sharpen',
      'gpu-grain',
      'gpu-vignette',
    ])
    expect(next[0]?.effect.params).toMatchObject({ lift: 0.065, contrast: 1.055, midDetail: 14 })
    expect(next[1]?.effect.params).toMatchObject({ amount: 0.78 })
  })

  it('replaces prior automated finishing entries on rerun', () => {
    const previous = effect('cinematic-finish:grade-1:old', 'gpu-color-wheels', { lift: 0.5 })
    const next = buildCinematicFinishingEffectStack([previous], () => 'new')

    expect(next).not.toContain(previous)
    expect(next[0]?.id).toBe('cinematic-finish:grade-1:new')
    expect(next[0]?.effect.params).toMatchObject({ lift: 0.032 })
  })

  it('targets visual media but skips hidden depth maps', () => {
    expect(
      shouldApplyCinematicFinishing({
        id: 'image',
        trackId: 'track',
        type: 'image',
        from: 0,
        durationInFrames: 30,
        label: 'Still',
        src: 'blob:image',
      }),
    ).toBe(true)
    expect(
      shouldApplyCinematicFinishing({
        id: 'depth',
        trackId: 'track',
        type: 'image',
        from: 0,
        durationInFrames: 30,
        label: 'Depth Map',
        src: 'blob:depth',
        cinematicDepthRole: 'depth-map',
      }),
    ).toBe(false)
  })

  it('plans finishing updates for selected visual items and generated depth layers', () => {
    const updates = buildCinematicFinishingUpdates(
      [
        {
          id: 'background',
          trackId: 'track',
          type: 'image',
          from: 0,
          durationInFrames: 30,
          label: 'Background',
          src: 'blob:bg',
          cinematicDepthRole: 'background',
        },
        {
          id: 'subject',
          trackId: 'track',
          type: 'image',
          from: 0,
          durationInFrames: 30,
          label: 'Subject',
          src: 'blob:subject',
          cinematicDepthRole: 'subject',
        },
        {
          id: 'depth',
          trackId: 'track',
          type: 'image',
          from: 0,
          durationInFrames: 30,
          label: 'Depth',
          src: 'blob:depth',
          cinematicDepthRole: 'depth-map',
        },
        {
          id: 'voice',
          trackId: 'audio',
          type: 'audio',
          from: 0,
          durationInFrames: 30,
          label: 'Narration',
          src: 'blob:voice',
          mediaId: 'voice-media',
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 30,
          sourceFps: 30,
        },
      ],
      ['background', 'subject', 'depth', 'voice'],
      () => 'cinema',
    )

    expect(updates.map((update) => update.itemId)).toEqual(['background', 'subject'])
    expect(updates.every((update) => update.effects.length >= 3)).toBe(true)
  })

  it('adds depth atmosphere only to the appropriate Magnates layers', () => {
    const updates = buildCinematicFinishingUpdates(
      [
        {
          id: 'background',
          trackId: 'track',
          type: 'image',
          from: 0,
          durationInFrames: 30,
          label: 'Background',
          src: 'blob:bg',
          cinematicDepthRole: 'background',
        },
        {
          id: 'subject',
          trackId: 'track',
          type: 'image',
          from: 0,
          durationInFrames: 30,
          label: 'Subject',
          src: 'blob:subject',
          cinematicDepthRole: 'subject',
        },
      ],
      ['background', 'subject'],
      () => 'fx',
      'magnates-3d',
    )

    expect(
      updates[0]?.effects.some((entry) => entry.effect.gpuEffectType === 'gpu-gaussian-blur'),
    ).toBe(true)
    expect(updates[1]?.effects.some((entry) => entry.effect.gpuEffectType === 'gpu-glow')).toBe(
      true,
    )
  })
})
