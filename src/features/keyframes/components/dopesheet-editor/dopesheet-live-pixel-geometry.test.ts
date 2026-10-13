import { describe, expect, it } from 'vite-plus/test'
import { syncDopesheetLivePixelGeometry } from './dopesheet-live-pixel-geometry'

describe('syncDopesheetLivePixelGeometry', () => {
  it('moves keyframes and spans to final pixels without scaling their hit targets', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button data-dopesheet-frame="30" style="width: 12px; height: 12px"></button>
      <div data-dopesheet-from-frame="30" data-dopesheet-to-frame="60"></div>
    `

    syncDopesheetLivePixelGeometry({
      root,
      pixelsPerSecond: 120,
      fps: 30,
      scrollLeft: 50,
      itemFrom: 10,
      originOffset: -1,
    })

    const keyframe = root.querySelector<HTMLElement>('[data-dopesheet-frame]')
    const span = root.querySelector<HTMLElement>('[data-dopesheet-from-frame]')
    expect(keyframe?.style.left).toBe('109px')
    expect(keyframe?.style.width).toBe('12px')
    expect(keyframe?.style.height).toBe('12px')
    expect(keyframe?.style.transform).toBe('')
    expect(span?.style.left).toBe('109px')
    expect(span?.style.width).toBe('120px')
  })

  it('updates easing insets, relative handles, and grid lines on the same pixel axis', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div
        data-dopesheet-from-frame="10"
        data-dopesheet-to-frame="40"
        data-dopesheet-responsive-inset="8"
        data-dopesheet-min-width="2"
      ></div>
      <div data-dopesheet-from-frame="10" data-dopesheet-to-frame="40">
        <button data-dopesheet-relative-frame="25"></button>
      </div>
      <div data-motion-grid-frames="0,15,30"></div>
    `

    syncDopesheetLivePixelGeometry({
      root,
      pixelsPerSecond: 60,
      fps: 30,
      scrollLeft: 10,
      itemFrom: 0,
    })

    const easing = root.querySelector<HTMLElement>('[data-dopesheet-responsive-inset]')
    const handle = root.querySelector<HTMLElement>('[data-dopesheet-relative-frame]')
    const grid = root.querySelector<HTMLElement>('[data-motion-grid-frames]')
    expect(easing?.style.left).toBe('18px')
    expect(easing?.style.width).toBe('44px')
    expect(handle?.style.left).toBe('30px')
    expect(grid?.style.left).toBe('-10px')
    expect(grid?.style.boxShadow).toBe('30px 0 currentColor, 60px 0 currentColor')
  })
})
