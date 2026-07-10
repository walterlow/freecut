import { describe, expect, it } from 'vitest'
import {
  buildAlphaSubjectMask,
  buildDepthSubjectMask,
  selectCinematicSubjectMask,
} from './cinematic-depth-prep'

function centeredDepthPlane(params: {
  polarity: 'bright' | 'dark'
  width?: number
  height?: number
}) {
  const width = params.width ?? 16
  const height = params.height ?? 16
  const data = new Uint8Array(width * height)
  const centerValue = params.polarity === 'bright' ? 230 : 25
  const edgeValue = params.polarity === 'bright' ? 35 : 225

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2
      const dy = y - height / 2
      const distance = Math.sqrt(dx * dx + dy * dy)
      data[y * width + x] = distance <= 4 ? centerValue : edgeValue
    }
  }

  return { data, width, height, channels: 1 as const }
}

describe('buildDepthSubjectMask', () => {
  it('selects a bright centered subject from a depth map', () => {
    const mask = buildDepthSubjectMask(centeredDepthPlane({ polarity: 'bright' }))

    const centerAlpha = mask.alpha[8 * mask.width + 8] ?? 0
    const cornerAlpha = mask.alpha[0] ?? 0

    expect(mask.polarity).toBe('bright-near')
    expect(centerAlpha).toBeGreaterThan(180)
    expect(cornerAlpha).toBeLessThan(60)
    expect(mask.coverage).toBeGreaterThan(0.08)
    expect(mask.quality).toBeGreaterThan(0.6)
  })

  it('can invert when the model encodes the near subject as dark', () => {
    const mask = buildDepthSubjectMask(centeredDepthPlane({ polarity: 'dark' }))

    const centerAlpha = mask.alpha[8 * mask.width + 8] ?? 0
    const cornerAlpha = mask.alpha[0] ?? 0

    expect(mask.polarity).toBe('dark-near')
    expect(centerAlpha).toBeGreaterThan(180)
    expect(cornerAlpha).toBeLessThan(60)
    expect(mask.coverage).toBeGreaterThan(0.08)
  })
})

describe('subject matting', () => {
  it('uses a detailed alpha matte when it is reliable', () => {
    const width = 12
    const height = 12
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = 90
        data[offset + 1] = 80
        data[offset + 2] = 70
        data[offset + 3] = x >= 3 && x <= 8 && y >= 2 && y <= 10 ? 240 : 4
      }
    }

    const matteMask = buildAlphaSubjectMask({ data, width, height, channels: 4 })
    const depthMask = buildDepthSubjectMask(
      centeredDepthPlane({ polarity: 'bright', width, height }),
    )
    const selected = selectCinematicSubjectMask({ depthMask, matteMask })

    expect(matteMask).not.toBeNull()
    expect(selected.source).toBe('matting')
    expect(selected.mask.coverage).toBeGreaterThan(0.15)
    expect(selected.mask.contrast).toBeGreaterThan(0.7)
  })

  it('falls back to depth when the alpha output is flat', () => {
    const width = 10
    const height = 10
    const data = new Uint8Array(width * height * 4).fill(128)
    const matteMask = buildAlphaSubjectMask({ data, width, height, channels: 4 })
    const depthMask = buildDepthSubjectMask(
      centeredDepthPlane({ polarity: 'bright', width, height }),
    )

    expect(matteMask).toBeNull()
    expect(selectCinematicSubjectMask({ depthMask, matteMask }).source).toBe('depth')
  })
})
