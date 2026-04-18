import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdjustmentItem } from '@/types/timeline';
import type { ItemEffect } from '@/types/effects';

const mockFns = vi.hoisted(() => ({
  applyMasksMock: vi.fn(),
}));

vi.mock('./canvas-masks', () => ({
  applyMasks: mockFns.applyMasksMock,
}));

import {
  getAdjustmentLayerEffects,
  renderEffectsFromMaskedSource,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';

function createGpuEffect(id: string, amount: number): ItemEffect {
  return {
    id,
    enabled: true,
    effect: {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-blur',
      params: { amount },
    },
  };
}

function createAdjustmentLayer(
  id: string,
  trackOrder: number,
  effects: ItemEffect[],
): AdjustmentLayerWithTrackOrder {
  const layer: AdjustmentItem = {
    id,
    type: 'adjustment',
    trackId: `track-${id}`,
    from: 0,
    durationInFrames: 60,
    label: `Adjustment ${id}`,
    effects,
  };

  return { layer, trackOrder };
}

function createMock2dContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  return {
    canvas,
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as OffscreenCanvasRenderingContext2D;
}

describe('getAdjustmentLayerEffects', () => {
  it('prefers preview overrides for active adjustment layers in preview mode', () => {
    const committedEffect = createGpuEffect('effect-1', 0.25);
    const previewEffect = createGpuEffect('effect-1', 0.8);
    const adjustmentLayers = [createAdjustmentLayer('adj-1', 1, [committedEffect])];

    const effects = getAdjustmentLayerEffects(
      3,
      adjustmentLayers,
      10,
      (itemId) => itemId === 'adj-1' ? [previewEffect] : undefined,
    );

    expect(effects).toEqual([previewEffect]);
  });

  it('falls back to committed effects when no preview override exists', () => {
    const committedEffect = createGpuEffect('effect-1', 0.25);
    const adjustmentLayers = [createAdjustmentLayer('adj-1', 1, [committedEffect])];

    const effects = getAdjustmentLayerEffects(3, adjustmentLayers, 10);

    expect(effects).toEqual([committedEffect]);
  });

  it('uses the live adjustment layer snapshot when committed effects change in preview mode', () => {
    const committedEffect = createGpuEffect('effect-1', 0.25);
    const updatedEffect = createGpuEffect('effect-1', 0.8);
    const adjustmentLayers = [createAdjustmentLayer('adj-1', 1, [committedEffect])];

    const effects = getAdjustmentLayerEffects(
      3,
      adjustmentLayers,
      10,
      undefined,
      (itemId) => itemId === 'adj-1'
        ? {
            ...adjustmentLayers[0]!.layer,
            effects: [updatedEffect],
          }
        : undefined,
    );

    expect(effects).toEqual([updatedEffect]);
  });

  it('ignores inactive or out-of-scope adjustment layers before checking overrides', () => {
    const activeEffect = createGpuEffect('active', 0.4);
    const inactiveEffect = createGpuEffect('inactive', 0.7);
    const sameTrackEffect = createGpuEffect('same-track', 0.9);
    const adjustmentLayers = [
      createAdjustmentLayer('adj-active', 1, [activeEffect]),
      {
        layer: {
          ...createAdjustmentLayer('adj-inactive', 0, [inactiveEffect]).layer,
          from: 40,
        },
        trackOrder: 0,
      },
      createAdjustmentLayer('adj-same-track', 3, [sameTrackEffect]),
    ];

    const previewLookups: string[] = [];
    const effects = getAdjustmentLayerEffects(
      3,
      adjustmentLayers,
      10,
      (itemId) => {
        previewLookups.push(itemId);
        return undefined;
      },
    );

    expect(effects).toEqual([activeEffect]);
    expect(previewLookups).toEqual(['adj-active']);
  });
});

describe('renderEffectsFromMaskedSource', () => {
  beforeEach(() => {
    mockFns.applyMasksMock.mockReset();
  });

  it('pre-masks the effect source before the effect chain draws from it', async () => {
    const sourceCanvas = { width: 1920, height: 1080 } as OffscreenCanvas;
    const maskedSourceCanvas = { width: 1920, height: 1080 } as OffscreenCanvas;
    const effectCanvas = { width: 1920, height: 1080 } as OffscreenCanvas;
    const maskedSourceCtx = createMock2dContext(maskedSourceCanvas);
    const effectCtx = createMock2dContext(effectCanvas);
    const canvasPool = {
      acquire: vi.fn()
        .mockReturnValueOnce({ canvas: maskedSourceCanvas, ctx: maskedSourceCtx })
        .mockReturnValueOnce({ canvas: effectCanvas, ctx: effectCtx }),
    };
    const masks = [{
      path: {} as Path2D,
      inverted: false,
      feather: 0,
      maskType: 'clip' as const,
    }];
    const effect = createGpuEffect('fx-1', 0.5);

    const result = await renderEffectsFromMaskedSource(
      canvasPool,
      sourceCanvas,
      [effect],
      masks,
      12,
      { width: 1920, height: 1080, fps: 30 },
    );

    expect(mockFns.applyMasksMock).toHaveBeenCalledWith(
      maskedSourceCtx,
      sourceCanvas,
      masks,
      { width: 1920, height: 1080, fps: 30 },
    );
    expect(effectCtx.drawImage).toHaveBeenCalledWith(maskedSourceCanvas, 0, 0);
    expect(result).toEqual({
      source: effectCanvas,
      poolCanvases: [maskedSourceCanvas, effectCanvas],
    });
  });
});
