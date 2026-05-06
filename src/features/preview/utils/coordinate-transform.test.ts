import { describe, expect, it } from 'vite-plus/test'
import { getScreenTransformOrigin } from './coordinate-transform'

describe('getScreenTransformOrigin', () => {
  it('scales the anchor into screen pixels', () => {
    const origin = getScreenTransformOrigin(
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        anchorX: 20,
        anchorY: 30,
        rotation: 0,
        opacity: 1,
      },
      {
        containerRect: new DOMRect(0, 0, 1000, 600),
        playerSize: { width: 500, height: 300 },
        projectSize: { width: 1000, height: 600 },
        zoom: -1,
      },
    )

    expect(origin).toBe('10px 15px')
  })
})
