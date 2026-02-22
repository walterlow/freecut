import { beforeEach, describe, expect, it } from 'vitest';
import type { VideoItem, TextItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { slipItem, slideItem } from './item-actions';

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

describe('slipItem', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useItemsStore.setState({ items: [], tracks: [] });
  });

  it('shifts sourceStart and sourceEnd by slipDelta', () => {
    const clip = makeVideoItem({
      id: 'slip-clip',
      from: 0,
      durationInFrames: 100,
      sourceStart: 50,
      sourceEnd: 150,
      sourceDuration: 300,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([clip]);

    slipItem('slip-clip', 20);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'slip-clip') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(70);
    expect(updated.sourceEnd).toBe(170);
    // Position and duration unchanged
    expect(updated.from).toBe(0);
    expect(updated.durationInFrames).toBe(100);
  });

  it('clamps so sourceStart does not go below 0', () => {
    const clip = makeVideoItem({
      id: 'slip-clip',
      from: 0,
      durationInFrames: 100,
      sourceStart: 10,
      sourceEnd: 110,
      sourceDuration: 300,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([clip]);

    // Try to slip left by 30 but sourceStart is only 10
    slipItem('slip-clip', -30);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'slip-clip') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(0);
    expect(updated.sourceEnd).toBe(100);
  });

  it('clamps so sourceEnd does not exceed sourceDuration', () => {
    const clip = makeVideoItem({
      id: 'slip-clip',
      from: 0,
      durationInFrames: 100,
      sourceStart: 180,
      sourceEnd: 280,
      sourceDuration: 300,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([clip]);

    // Try to slip right by 50 but sourceEnd can only go to 300
    slipItem('slip-clip', 50);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'slip-clip') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(200);
    expect(updated.sourceEnd).toBe(300);
  });

  it('does nothing for non-media items (text, shape, etc.)', () => {
    const textItem: TextItem = {
      id: 'text-clip',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
      label: 'Hello',
      text: 'Hello World',
      color: '#ffffff',
    };

    useItemsStore.getState().setItems([textItem]);

    slipItem('text-clip', 20);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'text-clip')!;
    // Item should be completely unchanged
    expect(updated.from).toBe(0);
    expect(updated.durationInFrames).toBe(100);
  });

  it('does nothing when slipDelta is 0', () => {
    const clip = makeVideoItem({
      id: 'slip-clip',
      from: 0,
      durationInFrames: 100,
      sourceStart: 50,
      sourceEnd: 150,
      sourceDuration: 300,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([clip]);

    slipItem('slip-clip', 0);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'slip-clip') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(50);
    expect(updated.sourceEnd).toBe(150);
  });
});

describe('slideItem', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useItemsStore.setState({ items: [], tracks: [] });
  });

  it('moves clip and adjusts adjacent neighbors correctly (slide right)', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
    });
    const middle = makeVideoItem({
      id: 'middle',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-2',
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-3',
    });

    useItemsStore.getState().setItems([left, middle, right]);

    // Slide middle clip right by 20 frames
    slideItem('middle', 20, 'left', 'right');

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left')!;
    const updatedMiddle = items.find((i) => i.id === 'middle')!;
    const updatedRight = items.find((i) => i.id === 'right')!;

    // Middle clip moved right by 20
    expect(updatedMiddle.from).toBe(120);
    expect(updatedMiddle.durationInFrames).toBe(100);

    // Left neighbor extended by 20 (fills gap)
    expect(updatedLeft.durationInFrames).toBe(120);

    // Right neighbor shrunk from start by 20
    expect(updatedRight.from).toBe(220);
    expect(updatedRight.durationInFrames).toBe(80);
  });

  it('moves clip and adjusts adjacent neighbors correctly (slide left)', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 200,
      sourceFps: 30,
    });
    const middle = makeVideoItem({
      id: 'middle',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-2',
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 100,
      sourceStart: 50,
      sourceEnd: 150,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-3',
    });

    useItemsStore.getState().setItems([left, middle, right]);

    // Slide middle clip left by 20 frames
    slideItem('middle', -20, 'left', 'right');

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left')!;
    const updatedMiddle = items.find((i) => i.id === 'middle')!;
    const updatedRight = items.find((i) => i.id === 'right')!;

    // Middle clip moved left by 20
    expect(updatedMiddle.from).toBe(80);
    expect(updatedMiddle.durationInFrames).toBe(100);

    // Left neighbor shrunk by 20
    expect(updatedLeft.from).toBe(0);
    expect(updatedLeft.durationInFrames).toBe(80);

    // Right neighbor extended from start by 20 (has sourceStart=50, room to extend)
    expect(updatedRight.from).toBe(180);
    expect(updatedRight.durationInFrames).toBe(120);
  });

  it('slides with null neighbors without errors', () => {
    const solo = makeVideoItem({
      id: 'solo',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([solo]);

    // Slide with no neighbors
    slideItem('solo', 30, null, null);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'solo')!;
    expect(updated.from).toBe(130);
    expect(updated.durationInFrames).toBe(100);
  });

  it('does nothing when slideDelta is 0', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
    });
    const middle = makeVideoItem({
      id: 'middle',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      mediaId: 'media-2',
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 100,
      mediaId: 'media-3',
    });

    useItemsStore.getState().setItems([left, middle, right]);

    slideItem('middle', 0, 'left', 'right');

    const items = useItemsStore.getState().items;
    expect(items.find((i) => i.id === 'left')!.durationInFrames).toBe(100);
    expect(items.find((i) => i.id === 'middle')!.from).toBe(100);
    expect(items.find((i) => i.id === 'right')!.from).toBe(200);
    expect(items.find((i) => i.id === 'right')!.durationInFrames).toBe(100);
  });

  it('preserves source continuity for split-contiguous A-B-C chains', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
      originId: 'origin-1',
      mediaId: 'media-1',
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });
    const middle = makeVideoItem({
      id: 'middle',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      originId: 'origin-1',
      mediaId: 'media-1',
      sourceStart: 100,
      sourceEnd: 200,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 100,
      originId: 'origin-1',
      mediaId: 'media-1',
      sourceStart: 200,
      sourceEnd: 300,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });

    useItemsStore.getState().setItems([left, middle, right]);

    slideItem('middle', 20, 'left', 'right');

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left') as VideoItem;
    const updatedMiddle = items.find((i) => i.id === 'middle') as VideoItem;
    const updatedRight = items.find((i) => i.id === 'right') as VideoItem;

    expect(updatedMiddle.from).toBe(120);
    expect(updatedMiddle.sourceStart).toBe(120);
    expect(updatedMiddle.sourceEnd).toBe(220);

    // Continuity at both edit points should remain intact.
    expect(updatedLeft.sourceEnd).toBe(updatedMiddle.sourceStart);
    expect(updatedMiddle.sourceEnd).toBe(updatedRight.sourceStart);
  });

  it('keeps default slide semantics for non-split chains', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
      originId: 'left-origin',
      mediaId: 'media-1',
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });
    const middle = makeVideoItem({
      id: 'middle',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      originId: 'middle-origin',
      mediaId: 'media-2',
      sourceStart: 50,
      sourceEnd: 150,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 100,
      originId: 'right-origin',
      mediaId: 'media-3',
      sourceStart: 25,
      sourceEnd: 125,
      sourceDuration: 400,
      sourceFps: 30,
      speed: 1,
    });

    useItemsStore.getState().setItems([left, middle, right]);

    slideItem('middle', 20, 'left', 'right');

    const updatedMiddle = useItemsStore.getState().items.find((i) => i.id === 'middle') as VideoItem;
    expect(updatedMiddle.from).toBe(120);
    // Middle clip source window remains unchanged when clips are not a split-contiguous chain.
    expect(updatedMiddle.sourceStart).toBe(50);
    expect(updatedMiddle.sourceEnd).toBe(150);
  });
});
