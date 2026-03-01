import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '@/features/preview/deps/timeline-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useVisualTransforms } from './use-visual-transform';
import type { TimelineItem } from '@/types/timeline';

const PROJECT_SIZE = { width: 1920, height: 1080 } as const;

const ITEM = {
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

function VisualTransformsProbe() {
  const transforms = useVisualTransforms([ITEM], PROJECT_SIZE);
  const resolved = transforms.get(ITEM.id);
  return (
    <div
      data-testid="visual-probe"
      data-x={String(resolved?.x ?? Number.NaN)}
    />
  );
}

function resetStores() {
  localStorage.clear();

  usePlaybackStore.setState({
    currentFrame: 10,
    currentFrameEpoch: 0,
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
        itemId: ITEM.id,
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

  useGizmoStore.setState({
    activeGizmo: null,
    previewTransform: null,
    preview: null,
    snapLines: [],
    canvasBackgroundPreview: null,
  });
}

describe('useVisualTransforms skimming frame resolution', () => {
  beforeEach(() => {
    resetStores();
  });

  it('uses previewFrame while paused', async () => {
    render(<VisualTransformsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110');
    });

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20);
    });

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '220');
    });
  });

  it('ignores previewFrame while playing', async () => {
    render(<VisualTransformsProbe />);

    act(() => {
      const playback = usePlaybackStore.getState();
      playback.setPreviewFrame(20);
      playback.play();
    });

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110');
    });
  });

  it('falls back to currentFrame when previewFrame is stale', async () => {
    render(<VisualTransformsProbe />);

    act(() => {
      const playback = usePlaybackStore.getState();
      playback.setPreviewFrame(20);
      playback.setCurrentFrame(30);
    });

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '330');
    });
  });
});
