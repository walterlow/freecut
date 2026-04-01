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
  shape?: MaskInfo['shape'],
): MaskInfo {
  return {
    shape: shape ?? ({ id } as MaskInfo['shape']),
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

  it('reuses the previous mask array when shape refs and transforms are unchanged', () => {
    const shape1 = { id: 'mask-1' } as MaskInfo['shape'];
    const shape2 = { id: 'mask-2' } as MaskInfo['shape'];
    const previous = [createMaskInfo('mask-1', 0, {}, shape1), createMaskInfo('mask-2', 0, {}, shape2)];
    const next = [createMaskInfo('mask-1', 0, {}, shape1), createMaskInfo('mask-2', 0, {}, shape2)];

    expect(reuseStableMaskInfos(previous, next)).toBe(previous);
  });

  it('returns a new array when shape reference changes (e.g. maskType update)', () => {
    const shape1 = { id: 'mask-1', maskType: 'alpha' } as MaskInfo['shape'];
    const shape1Updated = { id: 'mask-1', maskType: 'clip' } as MaskInfo['shape'];
    const previous = [createMaskInfo('mask-1', 0, {}, shape1)];
    const next = [createMaskInfo('mask-1', 0, {}, shape1Updated)];

    expect(reuseStableMaskInfos(previous, next)).not.toBe(previous);
  });

  it('returns a new array when any mask transform changes', () => {
    const sharedShape = { id: 'mask-1' } as MaskInfo['shape'];
    const previous = [createMaskInfo('mask-1', 0, {}, sharedShape)];
    const next = [createMaskInfo('mask-1', 0, { x: 42 }, sharedShape)];

    expect(reuseStableMaskInfos(previous, next)).toEqual(next);
    expect(reuseStableMaskInfos(previous, next)).not.toBe(previous);
  });

  it('returns a new array when any mask track order changes', () => {
    const sharedShape = { id: 'mask-1' } as MaskInfo['shape'];
    const previous = [createMaskInfo('mask-1', 0, {}, sharedShape)];
    const next = [createMaskInfo('mask-1', 1, {}, sharedShape)];

    expect(reuseStableMaskInfos(previous, next)).toEqual(next);
    expect(reuseStableMaskInfos(previous, next)).not.toBe(previous);
  });
});
