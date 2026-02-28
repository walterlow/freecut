import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Transition } from '@/types/transition';
import type { VideoItem } from '@/types/timeline';
import { useSelectionStore } from '@/shared/state/selection';
import { useItemsStore } from '../stores/items-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useZoomStore } from '../stores/zoom-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { TransitionItem } from './transition-item';

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  };
}

describe('TransitionItem preview bridge motion', () => {
  const transition: Transition = {
    id: 'tr-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-1',
    durationInFrames: 20,
  };

  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useZoomStore.getState().setZoomLevelImmediate(1);
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useSelectionStore.setState({ selectedTransitionId: null, dragState: null });
    useRollingEditPreviewStore.getState().clearPreview();
    useSlideEditPreviewStore.getState().clearPreview();
    useRippleEditPreviewStore.getState().clearPreview();
  });

  it('updates bridge position in realtime while slide preview delta changes', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 });
    const right = makeVideoItem({ id: 'right', from: 140, durationInFrames: 80, mediaId: 'media-2' });
    useItemsStore.getState().setItems([left, right]);

    render(<TransitionItem transition={transition} trackHeight={60} />);

    const overlay = screen.getByTitle('Fade (0.7s)');
    const initialLeftPx = parseFloat(overlay.style.left);

    act(() => {
      useSlideEditPreviewStore.getState().setPreview({
        itemId: 'left',
        trackId: 'track-1',
        leftNeighborId: null,
        rightNeighborId: null,
        slideDelta: 9,
      });
    });

    const updatedLeftPx = parseFloat(screen.getByTitle('Fade (0.7s)').style.left);
    expect(updatedLeftPx - initialLeftPx).toBe(30);
  });

  it('updates bridge position in realtime while rolling preview delta changes', () => {
    const left = makeVideoItem({ id: 'left', from: 100, durationInFrames: 60 });
    const right = makeVideoItem({ id: 'right', from: 140, durationInFrames: 80, mediaId: 'media-2' });
    useItemsStore.getState().setItems([left, right]);

    render(<TransitionItem transition={transition} trackHeight={60} />);

    const overlay = screen.getByTitle('Fade (0.7s)');
    const initialLeftPx = parseFloat(overlay.style.left);

    act(() => {
      useRollingEditPreviewStore.getState().setPreview({
        trimmedItemId: 'right',
        neighborItemId: 'left',
        handle: 'start',
        neighborDelta: -6,
      });
    });

    const updatedLeftPx = parseFloat(screen.getByTitle('Fade (0.7s)').style.left);
    expect(updatedLeftPx - initialLeftPx).toBe(-20);
  });
});
