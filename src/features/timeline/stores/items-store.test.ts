import { beforeEach, describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
import { useItemsStore } from './items-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { timelineToSourceFrames } from '../utils/source-calculations';
import { rollingTrimItems } from './actions/item-actions';

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

describe('items-store rate stretch', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
  });

  it('preserves explicit source bounds for split clips', () => {
    const splitClip = makeVideoItem({
      id: 'split-clip',
      durationInFrames: 1878,
      sourceStart: 1924,
      sourceEnd: 3425,
      sourceDuration: 4809,
      sourceFps: 23.981,
    });

    useItemsStore.getState().setItems([splitClip]);
    useItemsStore.getState()._rateStretchItem('split-clip', 0, 1500, 1.25);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'split-clip') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(1924);
    expect(updated.sourceEnd).toBe(3425);
    expect(updated.durationInFrames).toBe(1500);
    expect(updated.speed).toBeGreaterThan(1.25);
  });

  it('re-derives speed from fixed split source span even if incoming speed is mismatched', () => {
    const splitClip = makeVideoItem({
      id: 'split-clip-mismatch',
      durationInFrames: 1731,
      sourceStart: 3425,
      sourceEnd: 4809,
      sourceDuration: 4809,
      sourceFps: 23.981,
    });

    useItemsStore.getState().setItems([splitClip]);
    // Intentionally pass mismatched speed; store should normalize it.
    useItemsStore.getState()._rateStretchItem('split-clip-mismatch', 4285, 1467, 1);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'split-clip-mismatch') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(3425);
    expect(updated.sourceEnd).toBe(4809);
    expect(updated.durationInFrames).toBe(1467);
    expect(updated.speed).not.toBe(1);

    const needed = timelineToSourceFrames(updated.durationInFrames, updated.speed ?? 1, 30, updated.sourceFps ?? 30);
    expect(needed).toBeGreaterThanOrEqual((updated.sourceEnd ?? 0) - (updated.sourceStart ?? 0));
  });

  it('splitItem sets explicit sourceStart on both left and right items', () => {
    // Original clip with no explicit sourceStart (undefined)
    const clip = makeVideoItem({
      id: 'full-clip',
      from: 0,
      durationInFrames: 300,
      sourceDuration: 300,
      sourceFps: 30,
      // sourceStart intentionally undefined
    });

    useItemsStore.getState().setItems([clip]);
    const result = useItemsStore.getState()._splitItem('full-clip', 150);

    expect(result).not.toBeNull();
    const left = useItemsStore.getState().items.find((i) => i.id === 'full-clip') as VideoItem;
    const right = useItemsStore.getState().items.find((i) => i.id !== 'full-clip') as VideoItem;

    // Left item must have explicit sourceStart so rate stretch treats it as explicit bounds
    expect(left.sourceStart).toBe(0);
    expect(left.sourceEnd).toBe(150);

    // Right item should have correct bounds
    expect(right.sourceStart).toBe(150);
    expect(right.sourceEnd).toBe(300);
  });

  it('rate stretch on left split clip preserves source boundaries', () => {
    // Simulate a left split clip with explicit bounds (as fixed by splitItem)
    const leftClip = makeVideoItem({
      id: 'left-split',
      from: 0,
      durationInFrames: 150,
      sourceStart: 0,
      sourceEnd: 150,
      sourceDuration: 300,
      sourceFps: 30,
    });

    useItemsStore.getState().setItems([leftClip]);
    // Rate stretch to 0.5x speed (double duration)
    useItemsStore.getState()._rateStretchItem('left-split', 0, 300, 0.5);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'left-split') as VideoItem;
    expect(updated).toBeDefined();
    // Source bounds must NOT change - the clip should only use frames 0-150
    expect(updated.sourceStart).toBe(0);
    expect(updated.sourceEnd).toBe(150);
    expect(updated.durationInFrames).toBe(300);
    // Speed should be derived from the fixed 150-frame source span
    expect(updated.speed).toBeCloseTo(0.5, 1);
  });

  it('recomputes sourceEnd when explicit bounds are not present', () => {
    const openEndedClip = makeVideoItem({
      id: 'open-ended',
      durationInFrames: 100,
      sourceStart: 100,
      sourceDuration: 250,
      sourceFps: 30,
      sourceEnd: undefined,
    });

    useItemsStore.getState().setItems([openEndedClip]);
    useItemsStore.getState()._rateStretchItem('open-ended', 0, 200, 1);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'open-ended') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(100);
    // sourceStart + needed(200) would be 300, clamped by sourceDuration(250)
    expect(updated.sourceEnd).toBe(250);
  });

  it('normalizes legacy end-only bounds to sourceStart=0', () => {
    const legacySplit = makeVideoItem({
      id: 'legacy-end-only',
      durationInFrames: 120,
      sourceStart: undefined,
      sourceEnd: 300,
      sourceDuration: 4809,
      sourceFps: 23.981,
    });

    useItemsStore.getState().setItems([legacySplit]);

    const normalized = useItemsStore.getState().items.find((i) => i.id === 'legacy-end-only') as VideoItem;
    expect(normalized).toBeDefined();
    expect(normalized.sourceStart).toBe(0);
    expect(normalized.sourceEnd).toBe(300);
  });

  it('rate stretch preserves legacy end-only split bounds', () => {
    const legacySplit = makeVideoItem({
      id: 'legacy-end-only-stretch',
      from: 3985,
      durationInFrames: 2031,
      sourceStart: undefined,
      sourceEnd: 4809,
      sourceDuration: 4809,
      sourceFps: 23.981,
    });

    useItemsStore.getState().setItems([legacySplit]);
    useItemsStore.getState()._rateStretchItem('legacy-end-only-stretch', 3985, 1661, 1.223);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'legacy-end-only-stretch') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.sourceStart).toBe(0);
    expect(updated.sourceEnd).toBe(4809);
    expect(updated.durationInFrames).toBe(1661);

    const needed = timelineToSourceFrames(updated.durationInFrames, updated.speed ?? 1, 30, updated.sourceFps ?? 30);
    expect(needed).toBe((updated.sourceEnd ?? 0) - (updated.sourceStart ?? 0));
  });

  it('trim end on explicit split bounds applies delta-based sourceEnd update', () => {
    const splitClip = makeVideoItem({
      id: 'trim-end-split',
      from: 3985,
      durationInFrames: 2031,
      sourceStart: 3185,
      sourceEnd: 4809,
      sourceDuration: 4809,
      sourceFps: 23.981,
      speed: 1,
    });

    useItemsStore.getState().setItems([splitClip]);
    useItemsStore.getState()._trimItemEnd('trim-end-split', -164);

    const updated = useItemsStore.getState().items.find((i) => i.id === 'trim-end-split') as VideoItem;
    expect(updated).toBeDefined();
    expect(updated.durationInFrames).toBe(1867);
    // -164 timeline frames at 30fps equals -131 source frames at 23.981fps.
    expect(updated.sourceEnd).toBe(4678);
    expect(updated.sourceStart).toBe(3185);
    expect(updated.sourceDuration).toBe(4809);
  });
});

describe('rolling edit', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
  });

  it('moves edit point right between adjacent same-track clips (positive delta)', () => {
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
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-2',
    });

    useItemsStore.getState().setItems([left, right]);

    // Move edit point right by 20 frames
    rollingTrimItems('left', 'right', 20);

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left')!;
    const updatedRight = items.find((i) => i.id === 'right')!;

    // Left clip extended by 20
    expect(updatedLeft.durationInFrames).toBe(120);
    // Right clip shrunk by 20, start moved right by 20
    expect(updatedRight.from).toBe(120);
    expect(updatedRight.durationInFrames).toBe(80);
    // Total duration unchanged
    expect(updatedLeft.durationInFrames + updatedRight.durationInFrames).toBe(200);
  });

  it('moves edit point left between adjacent same-track clips (negative delta)', () => {
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
    // Right clip starts at source frame 50 so it has room to extend left
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      sourceStart: 50,
      sourceEnd: 250,
      sourceDuration: 250,
      sourceFps: 30,
      mediaId: 'media-2',
    });

    useItemsStore.getState().setItems([left, right]);

    // Move edit point left by 30 frames
    rollingTrimItems('left', 'right', -30);

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left')!;
    const updatedRight = items.find((i) => i.id === 'right')!;

    // Left clip shrunk by 30
    expect(updatedLeft.durationInFrames).toBe(70);
    // Right clip extended by 30, start moved left by 30
    expect(updatedRight.from).toBe(70);
    expect(updatedRight.durationInFrames).toBe(130);
    // Total duration unchanged
    expect(updatedLeft.durationInFrames + updatedRight.durationInFrames).toBe(200);
  });

  it('does nothing when editPointDelta is zero', () => {
    const left = makeVideoItem({
      id: 'left',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 100,
    });
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      mediaId: 'media-2',
    });

    useItemsStore.getState().setItems([left, right]);
    rollingTrimItems('left', 'right', 0);

    const items = useItemsStore.getState().items;
    expect(items.find((i) => i.id === 'left')!.durationInFrames).toBe(100);
    expect(items.find((i) => i.id === 'right')!.durationInFrames).toBe(100);
  });

  it('clamps delta when right clip is too short to shrink by full amount', () => {
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
    // Right clip is only 40 frames long — min-duration guard (1 frame) limits
    // shrink to 39, so a delta of 90 gets clamped.
    const right = makeVideoItem({
      id: 'right',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 40,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 200,
      sourceFps: 30,
      mediaId: 'media-2',
    });

    useItemsStore.getState().setItems([left, right]);

    // Request 90 but right can only shrink by 39 (100 - 1 min duration)
    rollingTrimItems('left', 'right', 90);

    const items = useItemsStore.getState().items;
    const updatedLeft = items.find((i) => i.id === 'left')!;
    const updatedRight = items.find((i) => i.id === 'right')!;

    // Right clamped to minimum 1 frame (shrank by 39, not 90)
    expect(updatedRight.durationInFrames).toBe(1);
    expect(updatedRight.from).toBe(139);
    // Left extended by 39 (adjacency-clamped to freed space)
    expect(updatedLeft.durationInFrames).toBe(139);
    // Total duration unchanged
    expect(updatedLeft.durationInFrames + updatedRight.durationInFrames).toBe(140);
    // Clips remain adjacent
    expect(updatedLeft.from + updatedLeft.durationInFrames).toBe(updatedRight.from);
  });
});
