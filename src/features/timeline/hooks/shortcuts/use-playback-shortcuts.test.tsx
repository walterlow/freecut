import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOTKEYS } from '@/config/hotkeys';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { useMarkersStore } from '../../stores/markers-store';
import { useItemsStore } from '../../stores/items-store';
import { useTransitionsStore } from '../../stores/transitions-store';
import { usePlaybackShortcuts } from './use-playback-shortcuts';
import type { TimelineTrack, VideoItem } from '@/types/timeline';

const { useHotkeysMock } = vi.hoisted(() => ({
  useHotkeysMock: vi.fn(),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: useHotkeysMock,
}));

vi.mock('@/features/timeline/deps/settings', () => ({
  useResolvedHotkeys: () => HOTKEYS,
}));

function ShortcutHarness() {
  usePlaybackShortcuts({});
  return null;
}

type HotkeyEvent = {
  preventDefault: () => void;
};

type HotkeyCallback = (event: HotkeyEvent) => void;

const TRACK: TimelineTrack = {
  id: 'track-1',
  name: 'V1',
  kind: 'video',
  order: 0,
  height: 80,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
};

const ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Clip 1',
  src: 'clip.mp4',
};

function getHotkeyRegistration(binding: string) {
  const registration = useHotkeysMock.mock.calls.find(([keys]) => keys === binding);

  expect(registration).toBeDefined();
  return registration as [string, HotkeyCallback];
}

describe('usePlaybackShortcuts', () => {
  beforeEach(() => {
    useHotkeysMock.mockClear();
    usePlaybackStore.setState({
      currentFrame: 12,
      previewFrame: 12,
      previewItemId: null,
      isPlaying: false,
    });
    usePreviewBridgeStore.setState({
      displayedFrame: 12,
      visualPlaybackMode: 'rendered_preview',
      streamingAudioProvider: null,
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
    });
    useSourcePlayerStore.setState({
      hoveredPanel: null,
      playerMethods: null,
    });
    useItemsStore.setState({
      tracks: [TRACK],
      items: [ITEM],
    });
    useMarkersStore.setState({
      markers: [],
    });
    useTransitionsStore.setState({
      transitions: [],
    });
  });

  it('keeps the last rendered frame latched during timeline hotkey seeks', () => {
    render(<ShortcutHarness />);

    const [, nextFrameCallback] = getHotkeyRegistration(HOTKEYS.NEXT_FRAME);
    const event = { preventDefault: vi.fn() };

    act(() => {
      nextFrameCallback(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(usePlaybackStore.getState()).toMatchObject({
      currentFrame: 13,
      previewFrame: null,
    });
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(12);
  });
});
