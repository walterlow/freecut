import { describe, expect, it, vi } from 'vitest';
import {
  renderDirectVideoGpuFrame,
  getAdjustmentLayerEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
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

describe('renderDirectVideoGpuFrame', () => {
  it('returns a deferred canvas when the gpu pipeline is batching', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      applyEffectsToVideo: vi.fn(() => resultCanvas),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [createGpuEffect('effect-1', 0.5)],
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      pipeline,
    );

    expect(deferred).toBe(resultCanvas);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect((pipeline as { applyEffectsToVideo: ReturnType<typeof vi.fn> }).applyEffectsToVideo)
      .toHaveBeenCalledWith(
        video,
        [
          {
            id: 'effect-1',
            type: 'gpu-blur',
            name: 'gpu-blur',
            enabled: true,
            params: { amount: 0.5 },
          },
        ],
        { x: 10, y: 20, width: 300, height: 200 },
        1280,
        720,
      );
  });

  it('draws the gpu result back into the target context outside batch mode', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => false),
      applyEffectsToVideo: vi.fn(() => resultCanvas),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [createGpuEffect('effect-1', 0.5)],
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      pipeline,
    );

    expect(deferred).toBeNull();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
  });

  it('uses the plain importExternalTexture render path when there are no gpu effects', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => false),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      pipeline,
    );

    expect(deferred).toBeNull();
    expect((pipeline as { renderVideoToCanvas: ReturnType<typeof vi.fn> }).renderVideoToCanvas)
      .toHaveBeenCalledWith(
        video,
        { x: 10, y: 20, width: 300, height: 200 },
        1280,
        720,
      );
    expect((pipeline as { applyEffectsToVideo: ReturnType<typeof vi.fn> }).applyEffectsToVideo)
      .not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
  });
});
