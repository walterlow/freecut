import { describe, expect, it } from 'vite-plus/test'

import { computeWaveformRenderWindow } from './render-window'

describe('computeWaveformRenderWindow', () => {
  it('bases visibility on the displayed clip width rather than the buffered render width', () => {
    const window = computeWaveformRenderWindow({
      renderWidth: 1010,
      visibleWidth: 980,
      visibleStartRatio: 0.99,
      visibleEndRatio: 1,
    })

    expect(window.visibleStartPx).toBe(970)
    expect(window.visibleEndPx).toBe(980)
  })

  it('defaults the visible width to the render width when no buffer is used', () => {
    const window = computeWaveformRenderWindow({
      renderWidth: 480,
      visibleStartRatio: 0.25,
      visibleEndRatio: 0.75,
    })

    expect(window.visibleStartPx).toBe(120)
    expect(window.visibleEndPx).toBe(360)
  })
})
