import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  useItemsStore,
  useTimelineStore,
  useTimelineSettingsStore,
  useTransitionsStore,
} from '@/features/preview/deps/timeline-store';
import { useGizmoStore } from '../stores/gizmo-store';

const seekToMock = vi.fn<(frame: number) => void>();
const playMock = vi.fn();
const pauseMock = vi.fn();
let mockedPlayerFrame = 0;
let mockedPlayerIsPlaying = false;
let lastPlayerDimensions: { width: number; height: number } | null = null;
let playerDimensionsHistory: Array<{ width: number; height: number }> = [];
let lastCompositionKeyframes: Array<{
  itemId: string;
  properties: Array<{
    property: string;
    keyframes: Array<{ frame: number; value: number }>;
  }>;
}> = [];

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/features/preview/deps/player-core', async () => {
  const React = await import('react');

  const MockPlayer = React.forwardRef<
    {
      seekTo: (frame: number) => void;
      play: () => void;
      pause: () => void;
      getCurrentFrame: () => number;
      isPlaying: () => boolean;
    },
    React.PropsWithChildren<{ width?: number; height?: number } & Record<string, unknown>>
  >(({ children, width, height }, ref) => {
    const [renderTick, setRenderTick] = React.useState(0);
    const safeWidth = Number.isFinite(width) ? Number(width) : 0;
    const safeHeight = Number.isFinite(height) ? Number(height) : 0;
    lastPlayerDimensions = { width: safeWidth, height: safeHeight };
    playerDimensionsHistory.push(lastPlayerDimensions);

    React.useImperativeHandle(ref, () => ({
      seekTo: (frame: number) => {
        mockedPlayerFrame = Math.round(frame);
        seekToMock(mockedPlayerFrame);
        setRenderTick((value) => value + 1);
      },
      play: () => {
        mockedPlayerIsPlaying = true;
        playMock();
        setRenderTick((value) => value + 1);
      },
      pause: () => {
        mockedPlayerIsPlaying = false;
        pauseMock();
        setRenderTick((value) => value + 1);
      },
      getCurrentFrame: () => mockedPlayerFrame,
      isPlaying: () => mockedPlayerIsPlaying,
    }), []);

    const syncedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(
        child as React.ReactElement<Record<string, unknown>>,
        { __playerFrameTick: renderTick }
      );
    });

    return <div data-testid="mock-player">{syncedChildren}</div>;
  });
  MockPlayer.displayName = 'MockPlayer';

  return {
    Player: MockPlayer,
    AbsoluteFill: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
  };
});

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: (props: {
    tracks?: Array<{ items?: Array<{ id?: string; transform?: { x?: number } }> }>;
    keyframes?: Array<{
      itemId: string;
      properties: Array<{
        property: string;
        keyframes: Array<{ frame: number; value: number }>;
      }>;
    }>;
  }) => {
    lastCompositionKeyframes = props.keyframes ?? [];
    return <div data-testid="mock-player-frame">{String(mockedPlayerFrame)}</div>;
  },
}));

vi.mock('./gizmo-overlay', () => ({
  GizmoOverlay: () => null,
}));

vi.mock('./rolling-edit-overlay', () => ({
  RollingEditOverlay: () => null,
}));

vi.mock('./ripple-edit-overlay', () => ({
  RippleEditOverlay: () => null,
}));

vi.mock('./slip-edit-overlay', () => ({
  SlipEditOverlay: () => null,
}));

vi.mock('./slide-edit-overlay', () => ({
  SlideEditOverlay: () => null,
}));

import { VideoPreview } from './video-preview';

function resetStores() {
  usePlaybackStore.setState({
    currentFrame: 0,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewItemId: null,
    captureFrame: null,
    useProxy: true,
    previewQuality: 1,
  });

  useItemsStore.getState().setTracks([]);
  useItemsStore.getState().setItems([]);
  useTimelineStore.setState({ keyframes: [] });
  useTransitionsStore.getState().setTransitions([]);
  useTransitionsStore.getState().setPendingBreakages([]);
  useTimelineSettingsStore.setState({
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
    isTimelineLoading: false,
  });

  useGizmoStore.setState({
    activeGizmo: null,
    previewTransform: null,
    preview: null,
    snapLines: [],
    canvasBackgroundPreview: null,
  });
}

describe('VideoPreview sync behavior', () => {
  beforeEach(() => {
    mockedPlayerFrame = 0;
    mockedPlayerIsPlaying = false;
    lastPlayerDimensions = null;
    playerDimensionsHistory = [];
    seekToMock.mockReset();
    playMock.mockReset();
    pauseMock.mockReset();
    lastCompositionKeyframes = [];
    localStorage.clear();
    resetStores();
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
  });

  it('seeks to currentFrame when previewFrame is stale and unchanged (ruler click path)', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(120);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(120);
    });
    seekToMock.mockClear();

    act(() => {
      // Simulates ruler click updating currentFrame while stale previewFrame lingers.
      usePlaybackStore.getState().setCurrentFrame(42);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(42);
    });
  });

  it('clears stale previewFrame when gizmo interaction starts', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(60);
    });
    expect(usePlaybackStore.getState().previewFrame).toBe(60);

    act(() => {
      useGizmoStore.setState({
        activeGizmo: {
          mode: 'translate',
          activeHandle: null,
          startPoint: { x: 0, y: 0 },
          startTransform: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
          currentPoint: { x: 0, y: 0 },
          shiftKey: false,
          ctrlKey: false,
          itemId: 'item-1',
        },
      });
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
    });
  });

  it('hands off scrub preview back to current frame when previewFrame is cleared', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      // Timeline scrub path updates both preview and main frame while dragging.
      usePlaybackStore.getState().setPreviewFrame(48);
      usePlaybackStore.getState().setCurrentFrame(48);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
    seekToMock.mockClear();

    act(() => {
      // Scrub release clears previewFrame.
      usePlaybackStore.getState().setPreviewFrame(null);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
    });
  });

  it('on play start, clears previewFrame and seeks to current playhead frame', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(72);
      usePlaybackStore.getState().setPreviewFrame(120);
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(120);
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().play();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBeNull();
      expect(seekToMock).toHaveBeenCalledWith(72);
      expect(playMock).toHaveBeenCalled();
    });
  });

  it('renders keyframed transform values correctly after scrub and seek handoff', async () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-1',
        name: 'Track 1',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'text',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 120,
        transform: { x: 0, y: 0, width: 100, height: 60, rotation: 0, opacity: 1 },
      } as unknown as (typeof useItemsStore.getState)['items'][number],
    ]);
    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: 'kf-48', frame: 48, value: 148, easing: 'linear' },
                { id: 'kf-72', frame: 72, value: 172, easing: 'linear' },
              ],
            },
          ],
        },
      ],
    });

    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalled();
    });
    seekToMock.mockClear();

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(48);
      usePlaybackStore.getState().setPreviewFrame(48);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(48);
      expect(screen.getByTestId('mock-player-frame')).toHaveTextContent('48');
    });
    seekToMock.mockClear();

    act(() => {
      // Simulate stale hover preview lingering while user performs a ruler seek.
      usePlaybackStore.getState().setPreviewFrame(120);
      usePlaybackStore.getState().setCurrentFrame(72);
    });

    await waitFor(() => {
      expect(seekToMock).toHaveBeenCalledWith(72);
      expect(screen.getByTestId('mock-player-frame')).toHaveTextContent('72');
      const keyframesForItem = lastCompositionKeyframes.find((entry) => entry.itemId === 'item-1');
      const xProperty = keyframesForItem?.properties.find((property) => property.property === 'x');
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 48 && keyframe.value === 148)).toBe(true);
      expect(xProperty?.keyframes.some((keyframe) => keyframe.frame === 72 && keyframe.value === 172)).toBe(true);
    });
  });

  it('keeps Player render geometry fixed when preview quality changes', async () => {
    render(
      <VideoPreview
        project={{ width: 1920, height: 1080, backgroundColor: '#000000' }}
        containerSize={{ width: 1280, height: 720 }}
      />
    );

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(0.25);
    });

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    act(() => {
      usePlaybackStore.getState().setPreviewQuality(1);
    });

    await waitFor(() => {
      expect(lastPlayerDimensions).toEqual({ width: 1920, height: 1080 });
    });

    expect(
      playerDimensionsHistory.every(
        (entry) => entry.width === 1920 && entry.height === 1080
      )
    ).toBe(true);
  });
});
