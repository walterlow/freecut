import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const sequenceContextValue = { localFrame: 28 };
const ensureReadyLanesMock = vi.fn(() => Promise.resolve());
const hoistedState = vi.hoisted(() => ({
  transitionParticipantSyncMock: vi.fn(),
}));
const playbackState = {
  isPlaying: false,
};
const previewBridgeState = {
  visualPlaybackMode: 'player' as 'player' | 'rendered_preview' | 'streaming',
  displayedFrame: null as number | null,
};

vi.mock('@/features/composition-runtime/deps/player', () => ({
  Sequence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSequenceContext: () => sequenceContextValue,
  useVideoSourcePool: () => ({ ensureReadyLanes: ensureReadyLanesMock }),
}));

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
}));

vi.mock('../hooks/use-transition-participant-sync', () => ({
  useTransitionParticipantSync: hoistedState.transitionParticipantSyncMock,
}));

vi.mock('@/features/composition-runtime/deps/stores', () => ({
  usePlaybackStore: (selector: (state: typeof playbackState) => unknown) => (
    selector(playbackState)
  ),
  useMediaLibraryStore: (selector: (state: { mediaItems: Array<{ id: string; fps: number }> }) => unknown) => (
    selector({ mediaItems: [] })
  ),
}));

vi.mock('@/shared/state/preview-bridge', () => ({
  usePreviewBridgeStore: (selector: (state: typeof previewBridgeState) => unknown) => (
    selector(previewBridgeState)
  ),
}));

vi.mock('./video-content', () => ({
  VideoContent: ({ item }: { item: { id: string; crop?: { softness?: number } } }) => (
    <div
      data-testid={`shadow-video-${item.id}`}
      data-softness={item.crop?.softness ?? ''}
    />
  ),
}));

import { StableVideoSequence } from './stable-video-sequence';

describe('StableVideoSequence', () => {
  beforeEach(() => {
    ensureReadyLanesMock.mockClear();
    hoistedState.transitionParticipantSyncMock.mockClear();
    sequenceContextValue.localFrame = 28;
    playbackState.isPlaying = false;
    previewBridgeState.visualPlaybackMode = 'player';
    previewBridgeState.displayedFrame = null;
  });

  it('uses a lightweight hidden bridge for shadow participants instead of renderItem', () => {
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toBeInTheDocument();
    expect(screen.getByTestId('shadow-video-right')).toBeInTheDocument();
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledTimes(1);
    expect(renderItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'left' }));
  });

  it('mounts same-origin shadow participants early enough before transition entry', () => {
    sequenceContextValue.localFrame = 22;
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toBeInTheDocument();
    expect(screen.getByTestId('shadow-video-right')).toBeInTheDocument();
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument();
  });

  it('updates transition participant crop softness when the clip crop changes', () => {
    const renderItem = vi.fn((item: { id: string; crop?: { softness?: number } }) => (
      <div data-testid={`render-${item.id}`} data-softness={item.crop?.softness ?? ''}>
        {item.id}
      </div>
    ));

    const { rerender } = render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            crop: { left: 0.1, softness: 0.1 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            crop: { right: 0.1, softness: 0.1 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toHaveAttribute('data-softness', '0.1');
    expect(screen.getByTestId('shadow-video-right')).toHaveAttribute('data-softness', '0.1');

    rerender(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            crop: { left: 0.1, softness: 0.25 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            crop: { right: 0.1, softness: 0.25 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toHaveAttribute('data-softness', '0.25');
    expect(screen.getByTestId('shadow-video-right')).toHaveAttribute('data-softness', '0.25');
  });

  it('skips shadow DOM and transition sync while streaming playback owns visuals', () => {
    playbackState.isPlaying = true;
    previewBridgeState.visualPlaybackMode = 'streaming';
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toBeInTheDocument();
    expect(screen.queryByTestId('shadow-video-right')).not.toBeInTheDocument();
    expect(hoistedState.transitionParticipantSyncMock).toHaveBeenCalledWith([], 0, 30);
  });

  it('skips shadow DOM and transition sync while paused rendered preview owns the frame', () => {
    previewBridgeState.visualPlaybackMode = 'rendered_preview';
    previewBridgeState.displayedFrame = 28;
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toBeInTheDocument();
    expect(screen.queryByTestId('shadow-video-right')).not.toBeInTheDocument();
    expect(hoistedState.transitionParticipantSyncMock).toHaveBeenCalledWith([], 0, 30);
  });
});
