import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import { useCompositionsStore, useTimelineStore, useGizmoStore } from '@/features/composition-runtime/deps/stores';
import type { CompositionItem, ShapeItem, TimelineTrack } from '@/types/timeline';
import { CompositionContent } from './composition-content';

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
    AbsoluteFill: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
      <div style={style}>{children}</div>
    ),
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
        <div data-sequence-from={from} data-sequence-duration={durationInFrames}>
          {children}
        </div>
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
  };
});

vi.mock('./item', async () => {
  const { useItemKeyframesFromContext } = await import('../contexts/keyframes-context');

  return {
    Item: ({ item }: { item: { id: string } }) => {
      const keyframes = useItemKeyframesFromContext(item.id);
      const keyframeCount = keyframes?.properties.reduce((count, property) => count + property.keyframes.length, 0) ?? 0;

      return (
        <div
          data-testid={`sub-item-${item.id}`}
          data-keyframe-count={String(keyframeCount)}
        />
      );
    },
  };
});

describe('CompositionContent keyframes', () => {
  beforeEach(() => {
    useCompositionsStore.setState({
      compositions: [],
      compositionById: {},
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    });
    useTimelineStore.setState({ keyframes: [] } as Partial<ReturnType<typeof useTimelineStore.getState>>);
    useGizmoStore.setState({
      activeGizmo: null,
      previewTransform: null,
      preview: null,
      snapLines: [],
      canvasBackgroundPreview: null,
    });
  });

  it('provides sub-comp keyframes to nested items during parent timeline render', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-content',
        name: 'Content',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ];

    const contentItem: ShapeItem = {
      id: 'sub-content',
      type: 'shape',
      trackId: 'sub-track-content',
      from: 0,
      durationInFrames: 60,
      label: 'Content shape',
      shapeType: 'rectangle',
      fillColor: '#ff0000',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    };

    const subComp = {
      id: 'sub-comp-1',
      name: 'Animated precomp',
      items: [contentItem],
      tracks: subTracks,
      transitions: [],
      keyframes: [
        {
          itemId: contentItem.id,
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'kf-1', frame: 0, value: 120, easing: 'linear' }],
            },
          ],
        },
      ],
      fps: 30,
      width: 1280,
      height: 720,
      durationInFrames: 60,
    };

    useCompositionsStore.setState({
      compositions: [subComp],
      compositionById: { [subComp.id]: subComp },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    });

    const compositionItem: CompositionItem = {
      id: 'parent-comp-item',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 60,
      label: 'Nested comp',
      compositionWidth: 1280,
      compositionHeight: 720,
    };

    render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent item={compositionItem} />
      </VideoConfigProvider>
    );

    expect(screen.getByTestId('sub-item-sub-content')).toHaveAttribute('data-keyframe-count', '1');
  });
});
