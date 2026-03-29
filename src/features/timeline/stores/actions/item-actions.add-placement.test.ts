import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import type { VideoItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { addItem, addItems } from './item-actions';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
  },
}));

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  };
}

describe('timeline add-item placement', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory();
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
    vi.mocked(toast.warning).mockReset();
  });

  it('pushes a colliding single item to the next free slot on the track', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'existing',
        from: 100,
        durationInFrames: 50,
      }),
    ]);

    addItem(makeVideoItem({
      id: 'new',
      from: 120,
      durationInFrames: 30,
    }));

    const inserted = useItemsStore.getState().items.find((item) => item.id === 'new');
    expect(inserted).toBeDefined();
    expect(inserted?.from).toBe(150);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('keeps batched items in order while moving them past occupied timeline segments', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'existing',
        from: 100,
        durationInFrames: 100,
      }),
    ]);

    addItems([
      makeVideoItem({
        id: 'first',
        from: 110,
        durationInFrames: 20,
      }),
      makeVideoItem({
        id: 'second',
        from: 130,
        durationInFrames: 20,
      }),
    ]);

    const items = useItemsStore.getState().items;
    const first = items.find((item) => item.id === 'first');
    const second = items.find((item) => item.id === 'second');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.from).toBe(200);
    expect(second?.from).toBe(220);
    expect(second?.from).toBeGreaterThan(first?.from ?? -1);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
