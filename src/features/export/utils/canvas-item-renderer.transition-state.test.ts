import { describe, expect, it } from 'vitest';
import type { ItemEffect } from '@/types/effects';
import type { VideoItem } from '@/types/timeline';
import type { ItemRenderContext } from './canvas-item-renderer';
import { resolveTransitionParticipantRenderState } from './canvas-item-renderer';

describe('resolveTransitionParticipantRenderState', () => {
  it('uses the current clip snapshot and preview overrides for transition participants', () => {
    const baseItem: VideoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      src: 'video.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    };
    const liveCrop = { left: 0.2 };
    const liveCornerPin = {
      topLeft: [0, 0] as [number, number],
      topRight: [10, 0] as [number, number],
      bottomRight: [10, 10] as [number, number],
      bottomLeft: [0, 10] as [number, number],
    };
    const previewEffect: ItemEffect = {
      id: 'fx-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-brightness',
        params: { amount: 0.2 },
      },
    };
    const currentItem: VideoItem = {
      ...baseItem,
      crop: liveCrop,
      transform: {
        x: 20,
        y: 30,
        width: 300,
        height: 150,
        rotation: 0,
        opacity: 1,
      },
    };
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
      getCurrentItemSnapshot: () => currentItem,
      getCurrentKeyframes: () => undefined,
      getPreviewTransformOverride: (itemId) => (
        itemId === baseItem.id
          ? { x: 45, width: 480, cornerRadius: 12 }
          : undefined
      ),
      getPreviewCornerPinOverride: (itemId) => (
        itemId === baseItem.id ? liveCornerPin : undefined
      ),
      getPreviewEffectsOverride: (itemId) => (
        itemId === baseItem.id ? [previewEffect] : undefined
      ),
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    };

    const result = resolveTransitionParticipantRenderState(baseItem, 12, 4, rctx);

    expect(result.item.crop).toEqual(liveCrop);
    expect(result.item.cornerPin).toEqual(liveCornerPin);
    expect(result.transform.x).toBe(45);
    expect(result.transform.y).toBe(30);
    expect(result.transform.width).toBe(480);
    expect(result.transform.height).toBe(150);
    expect(result.transform.cornerRadius).toBe(12);
    expect(result.effects).toEqual([previewEffect]);
  });

  it('does not zero opacity for a transition participant rendered before its nominal start', () => {
    const item: VideoItem = {
      id: 'video-2',
      type: 'video',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 90,
      label: 'Clip',
      src: 'video.mp4',
      fadeIn: 1,
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    };
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    };

    const result = resolveTransitionParticipantRenderState(item, 80, 0, rctx);

    expect(result.transform.opacity).toBe(1);
  });
});
