import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import { useCompositionsStore, useTimelineStore, useGizmoStore, useMaskEditorStore } from '@/features/composition-runtime/deps/stores';
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
    useMaskEditorStore.getState().stopEditing();
  });

  it('updates the applied mask clip-path while preview vertices are dragged', () => {
    const contentItem: ShapeItem = {
      id: 'content-shape',
      type: 'shape',
      trackId: 'content-track',
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

    const maskItem: ShapeItem = {
      id: 'path-mask',
      type: 'shape',
      trackId: 'mask-track',
      from: 0,
      durationInFrames: 60,
      label: 'Path mask',
      shapeType: 'path',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
      pathVertices: [
        {
          position: [0.2, 0.2],
          inHandle: [0.2, 0.2],
          outHandle: [0.2, 0.2],
        },
        {
          position: [0.6, 0.2],
          inHandle: [0.6, 0.2],
          outHandle: [0.6, 0.2],
        },
        {
          position: [0.6, 0.7],
          inHandle: [0.6, 0.7],
          outHandle: [0.6, 0.7],
        },
      ],
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    };

    const { container } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Item
          item={contentItem}
          muted={false}
          masks={[
            {
              shape: maskItem,
              transform: maskItem.transform!,
              trackOrder: 1,
            },
          ]}
        />
      </VideoConfigProvider>
    );

    const maskedElement = container.querySelector('[style*="clip-path"]');
    expect(maskedElement).not.toBeNull();
    expect((maskedElement as HTMLElement).style.width).toBe('100%');
    expect((maskedElement as HTMLElement).style.height).toBe('100%');
    const before = maskedElement?.getAttribute('style');

    act(() => {
      useMaskEditorStore.setState({
        isEditing: true,
        editingItemId: maskItem.id,
        previewVertices: [
          {
            position: [0.35, 0.15],
            inHandle: [0.35, 0.15],
            outHandle: [0.35, 0.15],
          },
          {
            position: [0.85, 0.2],
            inHandle: [0.85, 0.2],
            outHandle: [0.85, 0.2],
          },
          {
            position: [0.8, 0.85],
            inHandle: [0.8, 0.85],
            outHandle: [0.8, 0.85],
          },
        ],
      });
    });

    const after = container.querySelector('[style*="clip-path"]')?.getAttribute('style');
    expect(after).not.toBe(before);
  });

  it('keeps clip masks hard-edged even if a feather value is present', () => {
    const contentItem: ShapeItem = {
      id: 'content-shape',
      type: 'shape',
      trackId: 'content-track',
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

    const maskItem: ShapeItem = {
      id: 'clip-mask-with-feather',
      type: 'shape',
      trackId: 'mask-track',
      from: 0,
      durationInFrames: 60,
      label: 'Clip mask with feather',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
      maskFeather: 18,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    };

    const { container } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <Item
          item={contentItem}
          muted={false}
          masks={[
            {
              shape: maskItem,
              transform: maskItem.transform!,
              trackOrder: 1,
            },
          ]}
        />
      </VideoConfigProvider>
    );

    expect(container.querySelector('[style*="clip-path"]')).not.toBeNull();
    expect(container.querySelector('mask')).toBeNull();
  });

  it('applies sub-comp masks only to content on lower tracks', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-mask',
        name: 'Mask',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
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
        order: 1,
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

  it('does not apply a sub-comp mask to content above the mask track', () => {
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
      name: 'Unmasked precomp',
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

    expect(container.querySelector('[style*="clip-path"]')).toBeNull();
  });
});
