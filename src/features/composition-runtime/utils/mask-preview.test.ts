import { describe, expect, it } from 'vite-plus/test'
import { getRasterizedMaskLayerSettingsList } from './mask-preview'

describe('getRasterizedMaskLayerSettingsList', () => {
  it('preserves invert and alpha feather per mask layer', () => {
    const settings = getRasterizedMaskLayerSettingsList([
      {
        maskType: 'clip',
        maskFeather: 24,
        maskInvert: false,
      },
      {
        maskType: 'alpha',
        maskFeather: 18,
        maskInvert: true,
      },
    ])

    expect(settings).toEqual([
      {
        invert: false,
        feather: 0,
      },
      {
        invert: true,
        feather: 18,
      },
    ])
  })
})
