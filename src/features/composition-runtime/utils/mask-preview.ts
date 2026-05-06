import type { ShapeItem } from '@/types/timeline'

export interface RasterizedMaskLayerSettings {
  invert: boolean
  feather: number
}

export function getRasterizedMaskLayerSettings(
  shape: Pick<ShapeItem, 'maskType' | 'maskFeather' | 'maskInvert'>,
): RasterizedMaskLayerSettings {
  const maskType = shape.maskType ?? 'clip'

  return {
    invert: shape.maskInvert ?? false,
    feather: maskType === 'alpha' ? (shape.maskFeather ?? 0) : 0,
  }
}

export function getRasterizedMaskLayerSettingsList(
  shapes: Array<Pick<ShapeItem, 'maskType' | 'maskFeather' | 'maskInvert'>>,
): RasterizedMaskLayerSettings[] {
  return shapes.map(getRasterizedMaskLayerSettings)
}
