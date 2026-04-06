import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFns = vi.hoisted(() => ({
  drawCornerPinImageMock: vi.fn(),
}));

vi.mock('@/features/export/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/export/deps/composition-runtime')>(
    '@/features/export/deps/composition-runtime'
  );
  return {
    ...actual,
    drawCornerPinImage: mockFns.drawCornerPinImageMock,
  };
});

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
  beforeEach(() => {
    mockFns.drawCornerPinImageMock.mockReset();
  });

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
  beforeEach(() => {
    mockFns.drawCornerPinImageMock.mockReset();
  });

  it('returns a deferred canvas when the gpu pipeline is batching', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
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
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      1,
      0,
      0,
      undefined,
      undefined,
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
        { x: 10, y: 20, width: 300, height: 200 },
        { left: 0, right: 0, top: 0, bottom: 0 },
        1280,
        720,
      );
  });

  it('draws the gpu result back into the target context outside batch mode', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
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
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      1,
      0,
      0,
      undefined,
      undefined,
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
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
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
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      1,
      0,
      0,
      undefined,
      undefined,
      pipeline,
    );

    expect(deferred).toBeNull();
    expect((pipeline as { renderVideoToCanvas: ReturnType<typeof vi.fn> }).renderVideoToCanvas)
      .toHaveBeenCalledWith(
        video,
        { x: 10, y: 20, width: 300, height: 200 },
        { x: 10, y: 20, width: 300, height: 200 },
        { left: 0, right: 0, top: 0, bottom: 0 },
        1280,
        720,
      );
    expect((pipeline as { applyEffectsToVideo: ReturnType<typeof vi.fn> }).applyEffectsToVideo)
      .not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
  });

  it('flattens opacity into the effect canvas when batching would otherwise defer', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const targetCanvas = { width: 1280, height: 720 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1,
      canvas: targetCanvas,
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 10, y: 20, width: 300, height: 200 },
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      0.5,
      0,
      0,
      undefined,
      undefined,
      pipeline,
    );

    expect(deferred).toBeNull();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('can return the target canvas when a flattened direct video draw succeeds', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const targetCanvas = { width: 1280, height: 720 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1,
      canvas: targetCanvas,
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const flattened = renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 10, y: 20, width: 300, height: 200 },
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      0.5,
      0,
      0,
      undefined,
      undefined,
      pipeline,
      { returnTargetCanvasOnFlattened: true },
    );

    expect(flattened).toBe(targetCanvas);
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
  });

  it('forwards a cropped visible rect without rescaling the media rect', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => false),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 100, y: 80, width: 400, height: 300 },
      { x: 140, y: 110, width: 320, height: 240 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 100, y: 80, width: 400, height: 300 },
      { width: 1280, height: 720 },
      1,
      0,
      0,
      undefined,
      undefined,
      pipeline,
    );

    expect((pipeline as { renderVideoToCanvas: ReturnType<typeof vi.fn> }).renderVideoToCanvas)
      .toHaveBeenCalledWith(
        video,
        { x: 100, y: 80, width: 400, height: 300 },
        { x: 140, y: 110, width: 320, height: 240 },
        { left: 0, right: 0, top: 0, bottom: 0 },
        1280,
        720,
      );
  });

  it('forwards crop feather widths to the importExternalTexture path', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => false),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 100, y: 80, width: 400, height: 300 },
      { x: 120, y: 96, width: 360, height: 268 },
      { left: 20, right: 12, top: 16, bottom: 24 },
      { x: 100, y: 80, width: 400, height: 300 },
      { width: 1280, height: 720 },
      1,
      0,
      0,
      undefined,
      undefined,
      pipeline,
    );

    expect((pipeline as { renderVideoToCanvas: ReturnType<typeof vi.fn> }).renderVideoToCanvas)
      .toHaveBeenCalledWith(
        video,
        { x: 100, y: 80, width: 400, height: 300 },
        { x: 120, y: 96, width: 360, height: 268 },
        { left: 20, right: 12, top: 16, bottom: 24 },
        1280,
        720,
      );
  });

  it('flattens batching output when corner radius masking is needed', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      globalCompositeOperation: 'source-over',
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 10, y: 20, width: 300, height: 200 },
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      1,
      24,
      0,
      undefined,
      undefined,
      pipeline,
    );

    expect(deferred).toBeNull();
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.roundRect).toHaveBeenCalledWith(10, 20, 300, 200, 24);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('flattens batching output when 2d rotation is needed', () => {
    const resultCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;

    const deferred = renderDirectVideoGpuFrame(
      ctx,
      video,
      [],
      { x: 10, y: 20, width: 300, height: 200 },
      { x: 10, y: 20, width: 300, height: 200 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      { x: 10, y: 20, width: 300, height: 200 },
      { width: 1280, height: 720 },
      1,
      0,
      15,
      undefined,
      undefined,
      pipeline,
    );

    expect(deferred).toBeNull();
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 160, 120);
    expect(ctx.rotate).toHaveBeenCalledWith((15 * Math.PI) / 180);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -160, -120);
    expect(ctx.drawImage).toHaveBeenCalledWith(resultCanvas, 0, 0);
  });

  it('reuses the shared corner-pin warp helper after zero-copy video ingest', () => {
    const resultCanvas = { width: 300, height: 200 } as OffscreenCanvas;
    const itemCanvas = {
      width: 300,
      height: 200,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        globalCompositeOperation: 'source-over',
      })),
    } as unknown as OffscreenCanvas;
    class MockOffscreenCanvas {
      constructor(width: number, height: number) {
        void width;
        void height;
        return itemCanvas;
      }
    }
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const pipeline = {
      isBatching: vi.fn(() => true),
      renderVideoToCanvas: vi.fn(() => resultCanvas),
      applyEffectsToVideo: vi.fn(),
    } as unknown as import('@/infrastructure/gpu/effects').EffectsPipeline;
    const cornerPin = {
      topLeft: [0, 0],
      topRight: [24, -12],
      bottomRight: [10, 16],
      bottomLeft: [-18, 8],
    } as const;

    try {
      const deferred = renderDirectVideoGpuFrame(
        ctx,
        video,
        [],
        { x: 20, y: 10, width: 260, height: 180 },
        { x: 30, y: 20, width: 240, height: 160 },
        { left: 8, right: 4, top: 6, bottom: 10 },
        { x: 100, y: 80, width: 300, height: 200 },
        { width: 1280, height: 720 },
        1,
        0,
        0,
        cornerPin,
        undefined,
        pipeline,
      );

      expect(deferred).toBeNull();
      expect((pipeline as { renderVideoToCanvas: ReturnType<typeof vi.fn> }).renderVideoToCanvas)
        .toHaveBeenCalledWith(
          video,
          { x: 20, y: 10, width: 260, height: 180 },
          { x: 30, y: 20, width: 240, height: 160 },
          { left: 8, right: 4, top: 6, bottom: 10 },
          300,
          200,
        );
      expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1);
      expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.slice(2)).toEqual([
        300,
        200,
        100,
        80,
        cornerPin,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
