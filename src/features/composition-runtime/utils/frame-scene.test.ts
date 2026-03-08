import { describe, expect, it } from 'vitest';
import { resolveFrameCompositionScene } from './frame-scene';
import { resolveCompositionRenderPlan } from './scene-assembly';

describe('frame scene', () => {
  it('combines active masks and transition frame state from the render plan', () => {
    const renderPlan = resolveCompositionRenderPlan({
      tracks: [
        {
          id: 'track-1',
          name: 'Track 1',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [
            {
              id: 'mask-1',
              type: 'shape',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Mask 1',
              shapeType: 'rectangle',
              fillColor: '#fff',
              isMask: true,
              transform: {
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                rotation: 0,
                opacity: 1,
              },
            },
            {
              id: 'left',
              type: 'video',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              src: 'left.mp4',
              label: 'Left',
            },
            {
              id: 'right',
              type: 'video',
              trackId: 'track-1',
              from: 20,
              durationInFrames: 30,
              src: 'right.mp4',
              label: 'Right',
            },
          ],
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          leftClipId: 'left',
          rightClipId: 'right',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
    });

    const frameScene = resolveFrameCompositionScene({
      renderPlan,
      frame: 25,
      canvas: { width: 1280, height: 720, fps: 30 },
    });

    expect(frameScene.activeShapeMasks).toEqual([
      expect.objectContaining({
        shape: expect.objectContaining({ id: 'mask-1' }),
        transform: expect.objectContaining({ width: 200, height: 100 }),
      }),
    ]);
    expect(frameScene.transitionFrameState.activeTransitions).toEqual([
      expect.objectContaining({
        transition: expect.objectContaining({ id: 'transition-1' }),
      }),
    ]);
    expect(frameScene.transitionFrameState.transitionClipIds).toEqual(new Set(['left', 'right']));
  });
});
