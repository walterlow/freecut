import { describe, expect, it } from 'vitest';
import { getAdjustmentLayerEffects, type AdjustmentLayerWithTrackOrder } from './canvas-effects';
import type { AdjustmentItem } from '@/types/timeline';
import type { ItemEffect } from '@/types/effects';

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
