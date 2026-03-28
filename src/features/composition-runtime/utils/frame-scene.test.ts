import { describe, expect, it } from 'vitest';
import { resolveActiveShapeMasksAtFrame, resolveFrameCompositionScene } from './frame-scene';
import { resolveCompositionRenderPlan } from './scene-assembly';

describe('frame scene', () => {
  it('applies preview path vertices to active path masks', () => {
    const previewVertices = [
      {
        position: [0.9, 0.1] as [number, number],
        inHandle: [0.9, 0.1] as [number, number],
        outHandle: [0.9, 0.1] as [number, number],
      },
    ];
    const activeMasks = resolveActiveShapeMasksAtFrame([
      {
        id: 'mask-path',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: 'Mask path',
        shapeType: 'path',
        fillColor: '#fff',
        isMask: true,
        pathVertices: [
          {
            position: [0.1, 0.1],
            inHandle: [0.1, 0.1],
            outHandle: [0.1, 0.1],
          },
        ],
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          opacity: 1,
        },
      },
    ], {
      canvas: { width: 1280, height: 720, fps: 30 },
      frame: 5,
      getPreviewPathVertices: () => previewVertices,
    });

    expect(activeMasks).toHaveLength(1);
    expect(activeMasks[0]?.shape.pathVertices).toBe(previewVertices);
  });

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
        trackOrder: 1,
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
