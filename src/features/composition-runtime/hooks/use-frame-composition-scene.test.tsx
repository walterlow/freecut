import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { resolveCompositionRenderPlan, type CompositionRenderPlan } from '../utils/scene-assembly';

const { resolveFrameCompositionSceneSpy } = vi.hoisted(() => ({
  resolveFrameCompositionSceneSpy: vi.fn(),
}));

vi.mock('@/features/composition-runtime/deps/player', async () => {
  const React = await import('react');

  const VideoConfigContext = React.createContext({
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 120,
    id: 'test',
  });
  const SequenceContext = React.createContext<{
    from: number;
    durationInFrames: number;
    localFrame: number;
    parentFrom: number;
  } | null>(null);

  return {
    Sequence: ({
      children,
      from,
      durationInFrames,
    }: {
      children: React.ReactNode;
      from: number;
      durationInFrames: number;
    }) => (
      <SequenceContext.Provider
        value={{ from, durationInFrames, localFrame: 0, parentFrom: 0 }}
      >
        <div>{children}</div>
      </SequenceContext.Provider>
    ),
    useSequenceContext: () => React.useContext(SequenceContext),
    VideoConfigProvider: ({
      children,
      fps,
      width,
      height,
      durationInFrames,
      id = 'test',
    }: {
      children: React.ReactNode;
      fps: number;
      width: number;
      height: number;
      durationInFrames: number;
      id?: string;
    }) => (
      <VideoConfigContext.Provider value={{ fps, width, height, durationInFrames, id }}>
        {children}
      </VideoConfigContext.Provider>
    ),
    useVideoConfig: () => React.useContext(VideoConfigContext),
    useBridgedCurrentFrame: () => 0,
    useBridgedIsPlaying: () => false,
  };
});

vi.mock('../utils/frame-scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/frame-scene')>();
  resolveFrameCompositionSceneSpy.mockImplementation(actual.resolveFrameCompositionScene);

  return {
    ...actual,
    resolveFrameCompositionScene: resolveFrameCompositionSceneSpy,
  };
});

import { Sequence, VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import { useFrameCompositionScene } from './use-frame-composition-scene';

function buildRenderPlan(): CompositionRenderPlan {
  return resolveCompositionRenderPlan({
    tracks: [
      {
        id: 'track-mask',
        name: 'Mask',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [
          {
            id: 'shape-mask',
            type: 'shape',
            trackId: 'track-mask',
            from: 0,
            durationInFrames: 60,
            label: 'Shape mask',
            shapeType: 'rectangle',
            fillColor: '#ffffff',
            isMask: true,
            transform: {
              x: 0,
              y: 0,
              width: 640,
              height: 360,
              rotation: 0,
              opacity: 1,
            },
          },
          {
            id: 'video-item',
            type: 'video',
            trackId: 'track-mask',
            from: 0,
            durationInFrames: 60,
            src: 'clip.mp4',
            label: 'Clip',
          },
        ],
      },
    ],
    transitions: [],
  });
}

function FrameSceneConsumer({ renderPlan }: { renderPlan: CompositionRenderPlan }) {
  const frameScene = useFrameCompositionScene(renderPlan, {
    canvasWidth: 1280,
    canvasHeight: 720,
  });

  return <div data-active-mask-count={frameScene.activeShapeMasks.length} />;
}

describe('useFrameCompositionScene', () => {
  beforeEach(() => {
    resolveFrameCompositionSceneSpy.mockClear();
  });

  it('shares the same resolved frame scene across multiple consumers in the same frame', () => {
    const renderPlan = buildRenderPlan();

    render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Sequence from={10} durationInFrames={30}>
          <FrameSceneConsumer renderPlan={renderPlan} />
          <FrameSceneConsumer renderPlan={renderPlan} />
        </Sequence>
      </VideoConfigProvider>
    );

    expect(resolveFrameCompositionSceneSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the shared cache when the frame changes', () => {
    const renderPlan = buildRenderPlan();

    const { rerender } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Sequence from={10} durationInFrames={30}>
          <FrameSceneConsumer renderPlan={renderPlan} />
          <FrameSceneConsumer renderPlan={renderPlan} />
        </Sequence>
      </VideoConfigProvider>
    );

    rerender(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Sequence from={11} durationInFrames={30}>
          <FrameSceneConsumer renderPlan={renderPlan} />
          <FrameSceneConsumer renderPlan={renderPlan} />
        </Sequence>
      </VideoConfigProvider>
    );

    expect(resolveFrameCompositionSceneSpy).toHaveBeenCalledTimes(2);
  });
});
