import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_HEIGHT } from '../constants';
import { useTrackHeightResize } from './use-track-height-resize';
import { useItemsStore } from '../stores/items-store';
import { useTimelineCommandStore } from '../stores/timeline-command-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';

function createTrack(id: string, kind: 'video' | 'audio', height: number) {
  return {
    id,
    name: id.toUpperCase(),
    kind,
    order: 0,
    height,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  };
}

function Harness() {
  const { handleTrackResizeStart, handleTrackResizeReset } = useTrackHeightResize();

  return (
    <>
      <button type="button" onMouseDown={(event) => handleTrackResizeStart(event, 'v1')}>
        Resize V1
      </button>
      <button type="button" onDoubleClick={(event) => handleTrackResizeReset(event, 'v1')}>
        Reset V1
      </button>
    </>
  );
}

describe('useTrackHeightResize', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([
      createTrack('v1', 'video', 72),
      createTrack('v2', 'video', 96),
      createTrack('a1', 'audio', 120),
    ]);
    useTimelineCommandStore.getState().clearHistory();
    useTimelineSettingsStore.getState().markClean();
  });

  it('alt-drag resizes every track header together', () => {
    render(<Harness />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize V1' }), {
      altKey: true,
      clientY: 100,
    });
    fireEvent.mouseMove(document, { clientY: 110 });
    fireEvent.mouseUp(document, { clientY: 110 });

    expect(useItemsStore.getState().tracks.map((track) => track.height)).toEqual([62, 62, 62]);
    expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe('RESIZE_ALL_TRACKS');
  });

  it('alt-double-click resets every track height', () => {
    render(<Harness />);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Reset V1' }), {
      altKey: true,
    });

    expect(useItemsStore.getState().tracks.map((track) => track.height)).toEqual([
      DEFAULT_TRACK_HEIGHT,
      DEFAULT_TRACK_HEIGHT,
      DEFAULT_TRACK_HEIGHT,
    ]);
    expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe('RESET_ALL_TRACK_HEIGHTS');
  });
});
