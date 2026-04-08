import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOTKEYS } from '@/config/hotkeys';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '../../stores/timeline-store';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';
import { useEditingShortcuts } from './use-editing-shortcuts';
import type { TimelineTrack, VideoItem } from '@/types/timeline';

const { useHotkeysMock } = vi.hoisted(() => ({
  useHotkeysMock: vi.fn(),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: useHotkeysMock,
}));

function ShortcutHarness() {
  useEditingShortcuts({});
  return null;
}

type HotkeyEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
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
  return registration as [string, HotkeyCallback, { enabled?: boolean }];
}

function createHotkeyEvent(): HotkeyEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('useEditingShortcuts delete ownership', () => {
  beforeEach(() => {
    useHotkeysMock.mockClear();
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectionType: null,
    });
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [],
      clipboard: null,
      isCut: false,
    });
    useEditorStore.setState({
      keyframeEditorOpen: false,
      keyframeEditorShortcutScopeActive: false,
    });
    useTimelineStore.setState({
      tracks: [TRACK],
      items: [ITEM],
      transitions: [],
      keyframes: [],
      markers: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables clip delete shortcuts while the keyframe editor owns a keyframe selection', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
    });
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [{ itemId: 'clip-1', property: 'x', keyframeId: 'kf-1' }],
    });
    useEditorStore.setState({
      keyframeEditorOpen: true,
      keyframeEditorShortcutScopeActive: false,
    });

    render(<ShortcutHarness />);

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED);
    const [, backspaceCallback, backspaceOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED_ALT);
    const [, rippleDeleteCallback, rippleDeleteOptions] = getHotkeyRegistration(HOTKEYS.RIPPLE_DELETE);

    expect(deleteOptions.enabled).not.toBe(false);
    expect(backspaceOptions.enabled).not.toBe(false);
    expect(rippleDeleteOptions.enabled).not.toBe(false);

    const deleteEvent = createHotkeyEvent();
    const backspaceEvent = createHotkeyEvent();
    const rippleDeleteEvent = createHotkeyEvent();

    act(() => {
      deleteCallback(deleteEvent);
      backspaceCallback(backspaceEvent);
      rippleDeleteCallback(rippleDeleteEvent);
    });

    expect(useTimelineStore.getState().items).toHaveLength(1);
    expect(deleteEvent.preventDefault).toHaveBeenCalled();
    expect(deleteEvent.stopPropagation).toHaveBeenCalled();
    expect(backspaceEvent.preventDefault).toHaveBeenCalled();
    expect(backspaceEvent.stopPropagation).toHaveBeenCalled();
    expect(rippleDeleteEvent.preventDefault).toHaveBeenCalled();
    expect(rippleDeleteEvent.stopPropagation).toHaveBeenCalled();
  });

  it('disables clip delete shortcuts while the pointer or focus is inside the keyframe editor', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
    });
    useEditorStore.setState({
      keyframeEditorOpen: true,
      keyframeEditorShortcutScopeActive: true,
    });

    render(<ShortcutHarness />);

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED);
    const [, backspaceCallback, backspaceOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED_ALT);

    expect(deleteOptions.enabled).not.toBe(false);
    expect(backspaceOptions.enabled).not.toBe(false);

    const deleteEvent = createHotkeyEvent();
    const backspaceEvent = createHotkeyEvent();

    act(() => {
      deleteCallback(deleteEvent);
      backspaceCallback(backspaceEvent);
    });

    expect(useTimelineStore.getState().items).toHaveLength(1);
    expect(deleteEvent.preventDefault).toHaveBeenCalled();
    expect(deleteEvent.stopPropagation).toHaveBeenCalled();
    expect(backspaceEvent.preventDefault).toHaveBeenCalled();
    expect(backspaceEvent.stopPropagation).toHaveBeenCalled();
  });

  it('keeps clip delete shortcuts active when the keyframe editor is closed', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
    });
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [{ itemId: 'clip-1', property: 'x', keyframeId: 'kf-1' }],
    });
    useEditorStore.setState({
      keyframeEditorOpen: false,
      keyframeEditorShortcutScopeActive: false,
    });

    render(<ShortcutHarness />);

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED);
    expect(deleteOptions.enabled).not.toBe(false);

    const deleteEvent = createHotkeyEvent();
    act(() => {
      deleteCallback(deleteEvent);
    });

    expect(useTimelineStore.getState().items).toHaveLength(0);
    expect(deleteEvent.preventDefault).toHaveBeenCalled();
    expect(deleteEvent.stopPropagation).not.toHaveBeenCalled();
  });
});
