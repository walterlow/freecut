import { describe, expect, it } from 'vitest';
import {
  getClipMaskRasterScale,
  getClipMaskRasterSize,
  remapMaskImageDataToAlpha,
  shouldUseComplexClipMask,
} from './clip-mask-raster';
import type { ClipMask } from '@/types/masks';

function createMask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'mask-1',
    vertices: [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
    ...overrides,
  };
}

describe('shouldUseComplexClipMask', () => {
  it('returns false for simple additive clip masks', () => {
    expect(shouldUseComplexClipMask([createMask()])).toBe(false);
  });

  it('returns true for feathered clip masks', () => {
    expect(shouldUseComplexClipMask([createMask({ feather: 16 })])).toBe(true);
  });
});

describe('getClipMaskRasterScale', () => {
  it('keeps native resolution for non-feathered masks', () => {
    expect(getClipMaskRasterScale([createMask()], 1920, 1080)).toBe(1);
  });

  it('downscales large feathered masks', () => {
    expect(getClipMaskRasterScale([createMask({ feather: 24 })], 1920, 1080)).toBeLessThan(1);
  });
});

describe('getClipMaskRasterSize', () => {
  it('returns scaled raster dimensions for large feathered masks', () => {
    const size = getClipMaskRasterSize([createMask({ feather: 24 })], 1920, 1080);

    expect(size.width).toBe(960);
    expect(size.height).toBe(540);
    expect(size.scale).toBe(0.5);
  });
});

describe('remapMaskImageDataToAlpha', () => {
  it('moves grayscale mask strength into alpha for css masking', () => {
    const imageData = {
      data: new Uint8ClampedArray([
        0, 0, 0, 255,
        128, 128, 128, 255,
      ]),
    } as ImageData;

    const remapped = remapMaskImageDataToAlpha(imageData);

    expect(Array.from(remapped.data)).toEqual([
      255, 255, 255, 0,
      255, 255, 255, 128,
    ]);
  });
});
