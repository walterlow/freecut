import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import {
  useCompositionsStore,
  useGizmoStore,
  useTimelineStore,
} from '@/features/composition-runtime/deps/stores';
import type { CompositionItem, TimelineTrack } from '@/types/timeline';
import { CompositionContent } from './composition-content';

type TestSubComposition = ReturnType<typeof useCompositionsStore.getState>['compositions'][number];

const stableVideoSequenceSpy = vi.fn();

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

vi.mock('./item', () => ({
  Item: ({ item }: { item: { id: string } }) => <div data-testid={`sub-item-${item.id}`} />,
}));

vi.mock('./stable-video-sequence', () => ({
  StableVideoSequence: (props: {
    items: Array<{ id: string }>;
    renderItem: (item: { id: string }) => React.ReactNode;
  }) => {
    stableVideoSequenceSpy(props);
    return (
      <div data-testid="stable-video-sequence">
        {props.items.map((item) => (
          <div key={item.id} data-video-id={item.id}>
            {props.renderItem(item)}
          </div>
        ))}
      </div>
    );
  },
}));

describe('CompositionContent stable video identity', () => {
  beforeEach(() => {
    stableVideoSequenceSpy.mockClear();
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

  it('reuses nested stable-video items when only the wrapper transform changes', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-video',
        name: 'V1',
        kind: 'video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ];

    const subComp: TestSubComposition = {
      id: 'sub-comp-stable-video',
      name: 'Stable video precomp',
      items: [
        {
          id: 'nested-video',
          type: 'video',
          trackId: 'sub-track-video',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:video',
          originId: 'nested-video-origin',
        },
      ],
      tracks: subTracks,
      transitions: [],
      keyframes: [],
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

    const initialItem: CompositionItem = {
      id: 'parent-comp-item',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 60,
      label: 'Nested comp',
      compositionWidth: 1280,
      compositionHeight: 720,
      transform: {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      },
    };

    const { rerender } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent item={initialItem} />
      </VideoConfigProvider>
    );

    const firstItemsRef = stableVideoSequenceSpy.mock.lastCall?.[0]?.items;
    expect(firstItemsRef).toBeDefined();

    rerender(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent
          item={{
            ...initialItem,
            transform: {
              ...initialItem.transform!,
              x: 180,
            },
          }}
        />
      </VideoConfigProvider>
    );

    const secondItemsRef = stableVideoSequenceSpy.mock.lastCall?.[0]?.items;
    expect(secondItemsRef).toBe(firstItemsRef);
  });
});
