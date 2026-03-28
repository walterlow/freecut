import type { AnimatableProperty } from '@/types/keyframe';

export interface PropertyValueRange {
  property: AnimatableProperty;
  min: number;
  max: number;
  unit: string;
  decimals: number;
}

export const PROPERTY_VALUE_RANGES: Record<AnimatableProperty, PropertyValueRange> = {
  x: { property: 'x', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  y: { property: 'y', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  width: { property: 'width', min: 0, max: 2000, unit: 'px', decimals: 0 },
  height: { property: 'height', min: 0, max: 2000, unit: 'px', decimals: 0 },
  rotation: { property: 'rotation', min: -360, max: 360, unit: '°', decimals: 1 },
  opacity: { property: 'opacity', min: 0, max: 1, unit: '', decimals: 2 },
  cornerRadius: { property: 'cornerRadius', min: 0, max: 1000, unit: 'px', decimals: 0 },
  volume: { property: 'volume', min: -60, max: 20, unit: 'dB', decimals: 1 },
};
