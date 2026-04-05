import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const sequenceContextValue = { localFrame: 28 };

vi.mock('@/features/composition-runtime/deps/player', () => ({
  Sequence: ({
    children,
    from,
    premountFor,
    postmountFor,
  }: {
    children: React.ReactNode;
    from?: number;
    premountFor?: number;
    postmountFor?: number;
  }) => (
    <div
      data-testid={`sequence-${from ?? 0}`}
      data-sequence-from={String(from ?? 0)}
      data-premount-for={String(premountFor ?? 0)}
      data-postmount-for={String(postmountFor ?? 0)}
    >
      {children}
    </div>
  ),
  useSequenceContext: () => sequenceContextValue,
}));

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
}));

import { StableVideoSequence } from './stable-video-sequence';

describe('StableVideoSequence', () => {
  beforeEach(() => {
    sequenceContextValue.localFrame = 28;
  });

  it('renders the active clip from a same-origin group with a stable pool id', () => {
    const renderItem = vi.fn((item: { id: string; _poolClipId?: string; _sequenceFrameOffset?: number }) => (
      <div
        data-testid={`render-${item.id}`}
        data-pool-clip-id={item._poolClipId ?? ''}
        data-sequence-frame-offset={String(item._sequenceFrameOffset ?? '')}
      >
        {item.id}
      </div>
    ));

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
        transitionWindows={[{
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
        } as never]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left').getAttribute('data-pool-clip-id')).toMatch(/^group-/);
    expect(screen.getByTestId('render-left')).toHaveAttribute('data-sequence-frame-offset', '0');
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledTimes(1);
  });

  it('keeps the left participant active through a same-origin transition overlap', () => {
    sequenceContextValue.localFrame = 40;
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
        transitionWindows={[{
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
        } as never]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-left')).toBeInTheDocument();
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'left' }));
  });

  it('renders the incoming clip after the transition overlap ends', () => {
    sequenceContextValue.localFrame = 57;
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
        transitionWindows={[{
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
        } as never]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('render-right')).toBeInTheDocument();
    expect(screen.queryByTestId('render-left')).not.toBeInTheDocument();
  });

  it('extends premount for incoming groups when a transition starts before clip from', () => {
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-left',
            originId: 'origin-left',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-right',
            originId: 'origin-right',
            type: 'video',
            trackId: 'track-1',
            from: 90,
            durationInFrames: 90,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[{
          startFrame: 30,
          endFrame: 90,
          durationInFrames: 60,
          leftClip: { id: 'left' },
          rightClip: { id: 'right' },
          leftPortion: 60,
          rightPortion: 0,
          cutPoint: 90,
          transition: {
            id: 'transition-left-aligned',
            leftClipId: 'left',
            rightClipId: 'right',
            timing: 'linear',
          },
        } as never]}
        premountFor={30}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('sequence-90')).toHaveAttribute('data-premount-for', '60');
    expect(screen.getByTestId('sequence-0')).toHaveAttribute('data-premount-for', '30');
  });

  it('extends postmount for outgoing groups when a transition ends after clip end', () => {
    const renderItem = vi.fn((item: { id: string }) => <div data-testid={`render-${item.id}`}>{item.id}</div>);

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-left',
            originId: 'origin-left',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-right',
            originId: 'origin-right',
            type: 'video',
            trackId: 'track-1',
            from: 90,
            durationInFrames: 90,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[{
          startFrame: 90,
          endFrame: 150,
          durationInFrames: 60,
          leftClip: { id: 'left' },
          rightClip: { id: 'right' },
          leftPortion: 0,
          rightPortion: 60,
          cutPoint: 90,
          transition: {
            id: 'transition-right-aligned',
            leftClipId: 'left',
            rightClipId: 'right',
            timing: 'linear',
          },
        } as never]}
        renderItem={renderItem}
      />,
    );

    expect(screen.getByTestId('sequence-0')).toHaveAttribute('data-postmount-for', '60');
    expect(screen.getByTestId('sequence-90')).toHaveAttribute('data-postmount-for', '0');
  });
});
