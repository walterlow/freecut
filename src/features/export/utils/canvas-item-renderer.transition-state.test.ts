import { describe, expect, it, vi } from 'vitest';
import type { ItemEffect } from '@/types/effects';
import type { VideoItem } from '@/types/timeline';
import type { ItemRenderContext } from './canvas-item-renderer';
import type { VideoFrameSource } from './shared-video-extractor';
import {
  renderTransitionToCanvas,
  resolveTransitionSourcePlacement,
  resolveTransitionParticipantRenderState,
} from './canvas-item-renderer';
import type { ActiveTransition } from './canvas-transitions';

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

describe('resolveTransitionSourcePlacement', () => {
  it('computes placement from VideoFrame dimensions and item transform', () => {
    const item: VideoItem = {
      id: 'video-3',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Clip',
      src: 'video.mp4',
      crop: { left: 0.1, right: 0.05, top: 0.02 },
      transform: {
        x: 120,
        y: -40,
        width: 800,
        height: 450,
        rotation: 12,
        opacity: 0.8,
      },
    };
    const participant = {
      item,
      transform: {
        x: 120,
        y: -40,
        width: 800,
        height: 450,
        rotation: 12,
        opacity: 0.8,
        cornerRadius: 24,
      },
      effects: [],
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

    const videoFrame = { displayWidth: 1920, displayHeight: 1080 } as VideoFrame;
    const result = resolveTransitionSourcePlacement(participant, videoFrame, rctx);

    expect(result).not.toBeNull();
    expect(result!.itemRect).toEqual({
      x: 680,
      y: 275,
      width: 800,
      height: 450,
    });
    expect(result!.opacity).toBe(0.8);
    expect(result!.rotation).toBe(12);
    expect(result!.cornerRadius).toBe(24);
    expect(result!.visibleRect.width).toBeGreaterThan(0);
    expect(result!.visibleRect.height).toBeGreaterThan(0);
  });

  it('returns null for tiny VideoFrame dimensions', () => {
    const item: VideoItem = {
      id: 'video-4',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Clip',
      src: 'video.mp4',
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    };
    const participant = {
      item,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, cornerRadius: 0 },
      effects: [],
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

    const tinyFrame = { displayWidth: 1, displayHeight: 1 } as VideoFrame;
    expect(resolveTransitionSourcePlacement(participant, tinyFrame, rctx)).toBeNull();
  });
});

describe('renderTransitionToCanvas', () => {
  it('prefers live playback video elements over extractor VideoFrames for transformed playback transitions', async () => {
    const leftExtractorGetFrame = vi.fn(async () => ({ clone: () => ({ close: vi.fn() }) }));
    const rightExtractorGetFrame = vi.fn(async () => ({ clone: () => ({ close: vi.fn() }) }));
    const leftItem: VideoItem = {
      id: 'video-left',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Left',
      src: 'left.mp4',
      crop: { left: 0.08 },
      transform: {
        x: -120,
        y: 0,
        width: 760,
        height: 430,
        rotation: 6,
        opacity: 1,
      },
    };
    const rightItem: VideoItem = {
      id: 'video-right',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Right',
      src: 'right.mp4',
      transform: {
        x: 110,
        y: 20,
        width: 760,
        height: 430,
        rotation: -4,
        opacity: 0.92,
      },
    };
    const leftVideo = {
      readyState: 4,
      currentTime: 1,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const rightVideo = {
      readyState: 4,
      currentTime: 1,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const transformedRender = vi.fn(() => ({ width: 1920, height: 1080 } as OffscreenCanvas));
    const plainRender = vi.fn(() => null);
    const ctx = {
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const activeTransition: ActiveTransition = {
      transition: {
        id: 'transition-1',
        presentation: 'fade',
        durationInFrames: 20,
      } as ActiveTransition['transition'],
      leftClip: leftItem,
      rightClip: rightItem,
      progress: 0.4,
      transitionStart: 40,
      transitionEnd: 60,
      durationInFrames: 20,
      leftPortion: 10,
      rightPortion: 10,
      cutPoint: 50,
    };
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {
        acquire: () => ({ canvas: {} as OffscreenCanvas, ctx: {} as OffscreenCanvasRenderingContext2D }),
        release: () => {},
      } as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
      preferPlaybackVideoElements: true,
      videoExtractors: new Map([
        [leftItem.id, { getVideoFrameAtTimestamp: leftExtractorGetFrame } as unknown as VideoFrameSource],
        [rightItem.id, { getVideoFrameAtTimestamp: rightExtractorGetFrame } as unknown as VideoFrameSource],
      ]),
      videoElements: new Map([
        [leftItem.id, leftVideo],
        [rightItem.id, rightVideo],
      ]),
      useMediabunny: new Set([leftItem.id, rightItem.id]),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuTransitionPipeline: {
        renderVideoElements: plainRender,
        renderVideoElementsWithTransforms: transformedRender,
      } as unknown as ItemRenderContext['gpuTransitionPipeline'],
    };

    await renderTransitionToCanvas(ctx, activeTransition, 30, rctx, 0);

    expect(transformedRender).toHaveBeenCalledOnce();
    expect(plainRender).not.toHaveBeenCalled();
    expect(leftExtractorGetFrame).not.toHaveBeenCalled();
    expect(rightExtractorGetFrame).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledOnce();
  });
});
