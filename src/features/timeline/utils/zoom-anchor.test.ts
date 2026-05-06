import { describe, expect, it } from 'vite-plus/test'

import {
  getAnchoredZoomScrollLeft,
  getCursorZoomAnchor,
  getPlayheadZoomAnchor,
} from './zoom-anchor'

describe('zoom-anchor', () => {
  it('derives a cursor anchor from the visible cursor position', () => {
    expect(
      getCursorZoomAnchor({
        currentZoomLevel: 1,
        cursorScreenX: 180,
        maxDurationSeconds: 10,
        scrollLeft: 40,
      }),
    ).toEqual({
      anchorScreenX: 180,
      anchorTimeSeconds: 2.2,
    })
  })

  it('derives a playhead anchor from the current playhead frame', () => {
    expect(
      getPlayheadZoomAnchor({
        currentFrame: 60,
        currentZoomLevel: 1,
        fps: 30,
        maxDurationSeconds: 10,
        scrollLeft: 50,
      }),
    ).toEqual({
      anchorScreenX: 150,
      anchorTimeSeconds: 2,
    })
  })

  it('computes scrollLeft so the playhead stays in place while zooming', () => {
    const playheadAnchor = getPlayheadZoomAnchor({
      currentFrame: 60,
      currentZoomLevel: 1,
      fps: 30,
      maxDurationSeconds: 10,
      scrollLeft: 50,
    })

    expect(
      getAnchoredZoomScrollLeft({
        anchor: playheadAnchor,
        maxDurationSeconds: 10,
        nextZoomLevel: 2,
      }),
    ).toBe(250)
  })
})
