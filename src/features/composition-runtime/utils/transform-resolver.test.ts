import { describe, expect, it } from 'vite-plus/test'
import { toTransformStyle } from './transform-resolver'

describe('toTransformStyle', () => {
  it('includes horizontal flip in the CSS transform', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 160,
        anchorY: 90,
        rotation: 45,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
      { flipHorizontal: true },
    )

    expect(style.transform).toBe('rotate(45deg) scale(-1, 1)')
    expect(style.transformOrigin).toBe('160px 90px')
  })

  it('supports vertical-only flips without rotation', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 160,
        anchorY: 90,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
      { flipVertical: true },
    )

    expect(style.transform).toBe('scale(1, -1)')
  })

  it('uses explicit anchor values for transform origin', () => {
    const style = toTransformStyle(
      {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        anchorX: 24,
        anchorY: 36,
        rotation: 30,
        opacity: 1,
        cornerRadius: 0,
      },
      { width: 1920, height: 1080, fps: 30 },
    )

    expect(style.transformOrigin).toBe('24px 36px')
  })
})
