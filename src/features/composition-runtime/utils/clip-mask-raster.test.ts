import { describe, expect, it } from 'vitest';
import {
  getMaskRasterScale,
  getMaskRasterSize,
} from './clip-mask-raster';

describe('getMaskRasterScale', () => {
  it('keeps native resolution for non-feathered masks', () => {
    expect(getMaskRasterScale(0, 1920, 1080)).toBe(1);
  });

  it('downscales large feathered masks', () => {
    expect(getMaskRasterScale(24, 1920, 1080)).toBeLessThan(1);
  });
});

describe('getMaskRasterSize', () => {
  it('returns scaled raster dimensions for large feathered masks', () => {
    const size = getMaskRasterSize(24, 1920, 1080);

    expect(size.width).toBe(960);
    expect(size.height).toBe(540);
    expect(size.scale).toBe(0.5);
  });
});
