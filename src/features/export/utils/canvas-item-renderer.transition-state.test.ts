import { describe, expect, it } from 'vitest';
import type { ItemEffect } from '@/types/effects';
import type { VideoItem } from '@/types/timeline';
import type { ActiveTransition } from './canvas-transitions';
import type { ItemRenderContext } from './canvas-item-renderer';
import { resolveTransitionParticipantRenderState } from './canvas-item-renderer';

function createActiveTransition(overrides?: Partial<ActiveTransition>): ActiveTransition {
  return {
    transition: {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'iris',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 20,
    },
    leftClip: {
      id: 'left',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.mp4',
      label: 'Left',
    },
    rightClip: {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      src: 'right.mp4',
      label: 'Right',
    },
    progress: 0,
    transitionStart: 50,
    transitionEnd: 70,
    durationInFrames: 20,
    leftPortion: 10,
    rightPortion: 10,
    cutPoint: 60,
    ...overrides,
  } as ActiveTransition;
}

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
    const activeTransition = createActiveTransition({
      leftClip: baseItem,
      rightClip: {
        ...baseItem,
        id: 'video-2',
        from: 60,
      },
    });

    const result = resolveTransitionParticipantRenderState(baseItem, activeTransition, 12, 4, rctx);

    expect(result.item.crop).toEqual(liveCrop);
    expect(result.item.cornerPin).toEqual(liveCornerPin);
    expect(result.transform.x).toBe(45);
    expect(result.transform.y).toBe(30);
    expect(result.transform.width).toBe(480);
    expect(result.transform.height).toBe(150);
    expect(result.transform.cornerRadius).toBe(12);
    expect(result.effects).toEqual([previewEffect]);
    expect(result.renderSpan).toEqual({
      from: 0,
      durationInFrames: 90,
      sourceStart: 0,
    });
  });

  it('extends the incoming clip to the transition start so preroll frames stay visible', () => {
    const incomingClip: VideoItem = {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 40,
      sourceStart: 30,
      label: 'Incoming',
      src: 'right.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    };
    const activeTransition = createActiveTransition({ rightClip: incomingClip });
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

    const result = resolveTransitionParticipantRenderState(incomingClip, activeTransition, 50, 4, rctx);

    expect(result.item.from).toBe(60);
    expect(result.item.durationInFrames).toBe(40);
    expect(result.item.sourceStart).toBe(30);
    expect(result.renderSpan).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 20,
    });
    expect(result.transform.opacity).toBe(1);
  });

  it('extends the outgoing clip past its visible end for transition postroll', () => {
    const outgoingClip: VideoItem = {
      id: 'left',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Outgoing',
      src: 'left.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    };
    const activeTransition = createActiveTransition({ leftClip: outgoingClip });
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

    const result = resolveTransitionParticipantRenderState(outgoingClip, activeTransition, 65, 4, rctx);

    expect(result.item.from).toBe(0);
    expect(result.item.durationInFrames).toBe(60);
    expect(result.renderSpan).toEqual({
      from: 0,
      durationInFrames: 70,
      sourceStart: 0,
    });
    expect(result.transform.opacity).toBe(1);
  });

  it('clamps transition preroll to the available source head handle', () => {
    const incomingClip: VideoItem = {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 40,
      sourceStart: 6,
      label: 'Incoming',
      src: 'right.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    };
    const activeTransition = createActiveTransition({ rightClip: incomingClip });
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

    const result = resolveTransitionParticipantRenderState(incomingClip, activeTransition, 50, 4, rctx);

    expect(result.item.from).toBe(60);
    expect(result.item.durationInFrames).toBe(40);
    expect(result.item.sourceStart).toBe(6);
    expect(result.renderSpan).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 0,
    });
  });
});
