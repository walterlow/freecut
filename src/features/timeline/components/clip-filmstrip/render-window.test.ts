import { describe, expect, it } from 'vite-plus/test'
import { computeFilmstripRenderWindow } from './render-window'

describe('computeFilmstripRenderWindow', () => {
  it('keeps the trailing overscan width covered even when visibility ratios use the real clip width', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 412,
      visibleWidth: 400,
      tileWidth: 80,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
      minimumPadTiles: 0,
      minimumPadPx: 0,
    })

    expect(window.paddedStartX).toBe(0)
    expect(window.paddedEndX).toBe(412)
    expect(window.startTile).toBe(0)
    expect(window.endTile).toBe(6)
  })

  it('adds enough pixel overscan to absorb lagging viewport ratios near the left edge', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 1000,
      visibleWidth: 1000,
      tileWidth: 80,
      visibleStartRatio: 0.32,
      visibleEndRatio: 0.72,
      minimumPadTiles: 2,
      minimumPadPx: 600,
    })

    expect(window.paddedStartX).toBe(0)
    expect(window.startTile).toBe(0)
    expect(window.endTile).toBe(13)
  })

  it('clamps the padded end to the render width after applying overscan', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 500,
      visibleWidth: 480,
      tileWidth: 90,
      visibleStartRatio: 0.55,
      visibleEndRatio: 0.9,
      minimumPadTiles: 2,
      minimumPadPx: 600,
    })

    expect(window.paddedEndX).toBe(500)
    expect(window.endTile).toBe(6)
  })
})
