import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '@/features/keyframes/deps/timeline';
import { useAnimatedTransform, useAnimatedTransforms } from './use-animated-transform';
import type { TimelineItem } from '@/types/timeline';

const PROJECT_SIZE = { width: 1920, height: 1080 } as const;

const ANIMATED_ITEM = {
  id: 'item-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 200,
  label: 'Test Item',
  text: 'Hello',
  color: '#ffffff',
  transform: {
    x: 0,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
  },
} as unknown as TimelineItem;

const STATIC_ITEM = {
  id: 'item-2',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 200,
  label: 'Static Item',
  text: 'World',
  color: '#ffffff',
  transform: {
    x: 480,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
  },
} as unknown as TimelineItem;

function SingleAnimatedTransformProbe() {
  const { transform, relativeFrame } = useAnimatedTransform(ANIMATED_ITEM, PROJECT_SIZE);
  return (
    <div
      data-testid="single-probe"
      data-x={String(transform.x)}
      data-relative-frame={String(relativeFrame)}
    />
  );
}

function MultiAnimatedTransformsProbe() {
  const transforms = useAnimatedTransforms([ANIMATED_ITEM], PROJECT_SIZE);
  const resolved = transforms.get(ANIMATED_ITEM.id);
  return (
    <div
      data-testid="multi-probe"
      data-x={String(resolved?.x ?? Number.NaN)}
    />
  );
}

function SwitchingItemProbe() {
  const [activeId, setActiveId] = useState<'animated' | 'static'>('animated');
  const activeItem = activeId === 'animated' ? ANIMATED_ITEM : STATIC_ITEM;
  const { transform } = useAnimatedTransform(activeItem, PROJECT_SIZE);
  return (
    <>
      <button
        type="button"
        data-testid="switch-item"
        onClick={() => setActiveId(activeId === 'animated' ? 'static' : 'animated')}
      >
        Switch
      </button>
      <div data-testid="switch-probe" data-x={String(transform.x)} />
    </>
  );
}

function resetStores() {
  localStorage.clear();

  usePlaybackStore.setState({
    currentFrame: 10,
    currentFrameEpoch: 0,
    displayedFrame: null,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    captureFrame: null,
    useProxy: true,
    previewQuality: 1,
  });

  useTimelineStore.setState({
    keyframes: [
      {
        itemId: ANIMATED_ITEM.id,
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-10', frame: 10, value: 110, easing: 'linear' },
              { id: 'kf-20', frame: 20, value: 220, easing: 'linear' },
              { id: 'kf-30', frame: 30, value: 330, easing: 'linear' },
            ],
          },
        ],
      },
    ],
  });
}

describe('useAnimatedTransform skimming frame resolution', () => {
  beforeEach(() => {
    resetStores();
  });

  it('uses previewFrame while paused (single-item hook)', async () => {
    render(<SingleAnimatedTransformProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '110');
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '10');
    });

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20);
    });

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '220');
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '20');
    });
  });

  it('uses previewFrame while paused (multi-item hook)', async () => {
    render(<MultiAnimatedTransformsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('multi-probe')).toHaveAttribute('data-x', '110');
    });

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20);
    });

    await waitFor(() => {
      expect(screen.getByTestId('multi-probe')).toHaveAttribute('data-x', '220');
    });
  });

  it('ignores previewFrame while playing', async () => {
    render(<SingleAnimatedTransformProbe />);

    act(() => {
      const playback = usePlaybackStore.getState();
      playback.setPreviewFrame(20);
      playback.play();
    });

    await waitFor(() => {
      // Playing mode follows currentFrame, not previewFrame.
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '110');
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '10');
    });
  });

  it('falls back to currentFrame when previewFrame is stale', async () => {
    render(<SingleAnimatedTransformProbe />);

    act(() => {
      const playback = usePlaybackStore.getState();
      playback.setPreviewFrame(20);
      playback.setCurrentFrame(30);
    });

    await waitFor(() => {
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-x', '330');
      expect(screen.getByTestId('single-probe')).toHaveAttribute('data-relative-frame', '30');
    });
  });

  it('updates keyframe source when switching items without timeline changes', async () => {
    render(<SwitchingItemProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-probe')).toHaveAttribute('data-x', '110');
    });

    fireEvent.click(screen.getByTestId('switch-item'));

    await waitFor(() => {
      expect(screen.getByTestId('switch-probe')).toHaveAttribute('data-x', '480');
    });
  });
});
