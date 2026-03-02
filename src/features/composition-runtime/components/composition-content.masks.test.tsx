import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import { useCompositionsStore, useTimelineStore, useGizmoStore } from '@/features/composition-runtime/deps/stores';
import type { CompositionItem, ShapeItem, TimelineTrack } from '@/types/timeline';
import { Item } from './item';

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

  const interpolate = (
    input: number,
    inputRange: number[],
    outputRange: number[],
    options?: { extrapolateLeft?: 'clamp'; extrapolateRight?: 'clamp' }
  ) => {
    if (inputRange.length < 2 || outputRange.length < 2) return outputRange[0] ?? 0;
    const inStart = inputRange[0] ?? 0;
    const inEnd = inputRange[inputRange.length - 1] ?? 1;
    const outStart = outputRange[0] ?? 0;
    const outEnd = outputRange[outputRange.length - 1] ?? 0;
    let t = (input - inStart) / (inEnd - inStart || 1);
    if (options?.extrapolateLeft === 'clamp' || options?.extrapolateRight === 'clamp') {
      t = Math.max(0, Math.min(1, t));
    }
    return outStart + (outEnd - outStart) * t;
  };

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
    interpolate,
    useBridgedCurrentFrame: () => 0,
    useBridgedIsPlaying: () => false,
  };
});

describe('CompositionContent masks', () => {
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

  it('applies sub-comp masks when rendered as a single composition layer in parent timeline', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-mask',
        name: 'Mask',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
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

    const maskItem: ShapeItem = {
      id: 'sub-mask',
      type: 'shape',
      trackId: 'sub-track-mask',
      from: 0,
      durationInFrames: 60,
      label: 'Mask shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    };

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
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      },
    };

    const subComp = {
      id: 'sub-comp-1',
      name: 'Masked precomp',
      items: [maskItem, contentItem],
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

    const { container } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Item item={compositionItem} muted={false} masks={[]} />
      </VideoConfigProvider>
    );

    // Regression guard: mask control shapes inside precomp should not render as
    // regular timeline items when viewed from parent timeline.
    expect(container.querySelectorAll('[data-sequence-from]')).toHaveLength(1);

    // Regression guard: sub-comp mask should still clip child content in parent view.
    expect(container.querySelector('[style*="clip-path"]')).not.toBeNull();
  });
});
