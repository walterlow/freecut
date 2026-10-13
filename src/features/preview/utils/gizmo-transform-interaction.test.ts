import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  attachWindowTransformInteraction,
  suppressReleaseClick,
} from './gizmo-transform-interaction'

describe('suppressReleaseClick', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes the click synthesized immediately after a drag release', () => {
    const backgroundClick = vi.fn()
    window.addEventListener('click', backgroundClick)

    suppressReleaseClick()
    const releaseClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    window.dispatchEvent(releaseClick)

    expect(releaseClick.defaultPrevented).toBe(true)
    expect(backgroundClick).not.toHaveBeenCalled()
    window.removeEventListener('click', backgroundClick)
  })

  it('does not consume a later explicit click', () => {
    vi.useFakeTimers()
    const backgroundClick = vi.fn()
    window.addEventListener('click', backgroundClick)

    suppressReleaseClick()
    vi.runAllTimers()
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(backgroundClick).toHaveBeenCalledOnce()
    window.removeEventListener('click', backgroundClick)
  })
})

describe('attachWindowTransformInteraction', () => {
  it('applies the exact mouseup coordinates before committing the final transform', () => {
    let finalX = 0
    const updateInteraction = vi.fn((point: { x: number }) => {
      finalX = point.x
    })
    const onTransformEnd = vi.fn()

    attachWindowTransformInteraction({
      toCanvasPoint: (event) => ({ x: event.clientX, y: event.clientY }),
      updateInteraction,
      startTransform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
      endInteraction: () => ({
        x: finalX,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
      }),
      onTransformEnd,
      operation: 'move',
    })

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10 }))
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        clientX: 75,
        clientY: 10,
        shiftKey: true,
        ctrlKey: true,
        altKey: true,
      }),
    )

    expect(updateInteraction).toHaveBeenLastCalledWith({ x: 75, y: 10 }, true, true, true)
    expect(onTransformEnd).toHaveBeenCalledWith(expect.objectContaining({ x: 75 }), 'move')
  })
})
