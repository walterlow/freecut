import { describe, expect, it } from 'vitest';
import { getGpuEffect, getGpuEffectDefaultParams } from './index';

describe('GPU effect registry', () => {
  it('registers the dither effect with stable default uniforms', () => {
    const effect = getGpuEffect('gpu-dither');
    expect(effect).toBeDefined();
    expect(effect?.category).toBe('stylize');

    const defaults = getGpuEffectDefaultParams('gpu-dither');
    expect(defaults).toEqual({
      pattern: 'bayer4',
      mode: 'image',
      style: 'threshold',
      shape: 'square',
      palette: 'gameboy',
      cellSize: 8,
      angle: 45,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
    });

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual([
      8,
      45,
      100,
      1920,
      1080,
      0,
      0,
      1,
      0,
      0,
      1,
      1,
    ]);

    expect(effect!.params.angle.visibleWhen?.(defaults)).toBe(false);
    expect(effect!.params.angle.visibleWhen?.({ ...defaults, mode: 'linear' })).toBe(true);
    expect(effect!.params.scale.visibleWhen?.(defaults)).toBe(false);
    expect(effect!.params.scale.visibleWhen?.({ ...defaults, mode: 'radial' })).toBe(true);
  });
});
