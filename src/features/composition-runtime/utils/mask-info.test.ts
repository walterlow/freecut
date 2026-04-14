import { describe, expect, it } from 'vitest';
import type { MaskInfo } from '../components/item';
import {
  EMPTY_MASK_INFOS,
  materializeMaskInfos,
  reuseStableMaskInfos,
} from './mask-info';

function createMaskInfo(
  id: string,
  trackOrder: number = 0,
  overrides: Partial<MaskInfo['transform']> = {},
): MaskInfo {
  return {
    shape: { id } as MaskInfo['shape'],
    trackOrder,
    transform: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
      ...overrides,
    },
  };
}

describe('mask-info helpers', () => {
  it('returns the shared empty array for empty resolved masks', () => {
    expect(materializeMaskInfos([])).toBe(EMPTY_MASK_INFOS);
  });

  it('reuses the previous mask array when shape ids and transforms are unchanged', () => {
    const previous = [createMaskInfo('mask-1'), createMaskInfo('mask-2')];
    const next = [createMaskInfo('mask-1'), createMaskInfo('mask-2')];

    expect(reuseStableMaskInfos(previous, next)).toBe(previous);
  });

  it('returns a new array when any mask transform changes', () => {
    const previous = [createMaskInfo('mask-1')];
    const next = [createMaskInfo('mask-1', 0, { x: 42 })];

    expect(reuseStableMaskInfos(previous, next)).toEqual(next);
    expect(reuseStableMaskInfos(previous, next)).not.toBe(previous);
  });

  it('returns a new array when any mask track order changes', () => {
    const previous = [createMaskInfo('mask-1', 0)];
    const next = [createMaskInfo('mask-1', 1)];

    expect(reuseStableMaskInfos(previous, next)).toEqual(next);
    expect(reuseStableMaskInfos(previous, next)).not.toBe(previous);
  });
});
