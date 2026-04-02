import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import type { AudioItem, VideoItem } from '@/types/timeline';
import { ClipPanel } from './index';

vi.mock('./layout-section', () => ({
  LayoutSection: () => <div>Layout Body</div>,
}));

vi.mock('./fill-section', () => ({
  FillSection: () => <div>Fill Body</div>,
}));

vi.mock('./corner-pin-section', () => ({
  CornerPinSection: () => <div>Corner Pin Body</div>,
}));

vi.mock('./video-section', () => ({
  VideoSection: () => <div>Video Body</div>,
}));

vi.mock('./gif-section', () => ({
  GifSection: () => <div>Gif Body</div>,
}));

vi.mock('./audio-section', () => ({
  AudioSection: () => <div>Audio Body</div>,
}));

vi.mock('./text-section', () => ({
  TextSection: () => <div>Text Body</div>,
}));

vi.mock('./shape-section', () => ({
  ShapeSection: () => <div>Shape Body</div>,
}));

vi.mock('@/features/editor/deps/effects-contract', () => ({
  EffectsSection: () => <div>Effects Body</div>,
}));

const VIDEO_ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:video',
  mediaId: 'media-video-1',
};

const AUDIO_ITEM: AudioItem = {
  id: 'clip-audio-1',
  type: 'audio',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.wav',
  src: 'blob:audio',
  mediaId: 'media-audio-1',
};

function activateTab(name: 'Audio' | 'Effects' | 'Video') {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.focus(tab);
}

function resetStores(items: Array<VideoItem | AudioItem>, selectedItemIds: string[]) {
  useEditorStore.setState({
    clipInspectorTab: 'video',
    linkedSelectionEnabled: true,
  });

  useSelectionStore.setState({
    selectedItemIds,
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: selectedItemIds.length > 0 ? 'item' : null,
    dragState: null,
  });

  useTimelineStore.setState({
    fps: 30,
    items,
    keyframes: [],
  } as Partial<ReturnType<typeof useTimelineStore.getState>>);
}

describe('ClipPanel inspector tabs', () => {
  beforeEach(() => {
    resetStores([VIDEO_ITEM], [VIDEO_ITEM.id]);
  });

  it('restores the last selected clip tab after deselecting and reselecting', async () => {
    render(<ClipPanel />);

    activateTab('Effects');

    await waitFor(() => {
      expect(screen.getByText('Effects Body')).toBeInTheDocument();
    });
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects');

    act(() => {
      useSelectionStore.getState().selectItems([]);
    });

    await waitFor(() => {
      expect(screen.queryByText('Effects Body')).not.toBeInTheDocument();
    });
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects');

    act(() => {
      useSelectionStore.getState().selectItems([VIDEO_ITEM.id]);
    });

    await waitFor(() => {
      expect(screen.getByText('Effects Body')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Effects' })).toHaveAttribute('data-state', 'active');
  });

  it('falls back to the first valid tab and updates the remembered tab', async () => {
    useEditorStore.getState().setClipInspectorTab('video');
    resetStores([AUDIO_ITEM], [AUDIO_ITEM.id]);

    render(<ClipPanel />);

    await waitFor(() => {
      expect(screen.getByText('Audio Body')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Audio' })).toHaveAttribute('data-state', 'active');
    expect(useEditorStore.getState().clipInspectorTab).toBe('audio');
  });
});
