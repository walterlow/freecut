import { describe, expect, it } from 'vite-plus/test'
import { fitFilmstripFrameSize } from './fit-filmstrip-frame-size'

describe('fitFilmstripFrameSize', () => {
  it('preserves a wide source aspect ratio', () => {
    expect(fitFilmstripFrameSize(3840, 1920, 206, 116)).toEqual({ width: 206, height: 103 })
  })

  it('preserves a portrait source aspect ratio', () => {
    expect(fitFilmstripFrameSize(1080, 1920, 206, 116)).toEqual({ width: 65, height: 116 })
  })

  it('uses the extraction budget for a matching aspect ratio', () => {
    expect(fitFilmstripFrameSize(1920, 1080, 206, 116)).toEqual({ width: 206, height: 116 })
  })
})
