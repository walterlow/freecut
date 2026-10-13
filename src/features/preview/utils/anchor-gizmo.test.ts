import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Transform } from '../types/gizmo'
import { attachWindowAnchorInteraction, calculateAnchorDrag } from './anchor-gizmo'

const transform: Transform = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  anchorX: 100,
  anchorY: 50,
  rotation: 90,
  opacity: 1,
  cornerRadius: 0,
}

describe('calculateAnchorDrag', () => {
  it('moves the anchor in local space and compensates position to preserve the pose', () => {
    const result = calculateAnchorDrag(transform, { x: 0, y: 0 }, { x: 0, y: 20 })

    expect(result.anchorX).toBeCloseTo(120)
    expect(result.anchorY).toBeCloseTo(50)
    expect(result.x).toBeCloseTo(-20)
    expect(result.y).toBeCloseTo(20)
  })

  it('does not need position compensation on an unrotated item', () => {
    const result = calculateAnchorDrag(
      { ...transform, rotation: 0 },
      { x: 10, y: 10 },
      { x: 30, y: 25 },
    )
    expect(result).toMatchObject({ x: 0, y: 0, anchorX: 120, anchorY: 65 })
  })
})

describe('attachWindowAnchorInteraction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flushes the exact mouseup point, commits once, and restores after handoff', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const setPreview = vi.fn()
    const restorePreview = vi.fn()
    const onCommit = vi.fn()
    const onFinish = vi.fn()

    attachWindowAnchorInteraction({
      startTransform: { ...transform, rotation: 0 },
      startPoint: { x: 0, y: 0 },
      toCanvasPoint: (event) => ({ x: event.clientX, y: event.clientY }),
      setPreview,
      restorePreview,
      onCommit,
      onFinish,
    })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 5 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 40, clientY: 25 }))

    expect(setPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchorX: 140, anchorY: 75 }),
    )
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ anchorX: 140, anchorY: 75 }))
    expect(restorePreview).toHaveBeenCalledWith(true)
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('cancels without committing and restores the previous preview immediately', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const restorePreview = vi.fn()
    const onCommit = vi.fn()
    const cancel = attachWindowAnchorInteraction({
      startTransform: transform,
      startPoint: { x: 0, y: 0 },
      toCanvasPoint: (event) => ({ x: event.clientX, y: event.clientY }),
      setPreview: vi.fn(),
      restorePreview,
      onCommit,
    })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10 }))
    cancel()
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 10 }))

    expect(onCommit).not.toHaveBeenCalled()
    expect(restorePreview).toHaveBeenCalledOnce()
    expect(restorePreview).toHaveBeenCalledWith(false)
  })
})
