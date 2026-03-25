import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import {
  canLinkSelection,
  canLinkItems,
  expandSelectionWithLinkedItems,
  getLinkedItemIds,
  getLinkedSyncOffsetFrames,
  getUniqueLinkedItemAnchorIds,
  hasLinkedItems,
} from './linked-items';

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'clip',
    mediaId: 'media-1',
    src: 'blob:test',
    ...overrides,
  } as TimelineItem;
}

describe('linked items', () => {
  it('returns all items in the same linked group', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video' }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio' }),
      makeItem({ id: 'video-2', linkedGroupId: 'group-2', type: 'video' }),
    ];

    expect(getLinkedItemIds(items, 'video-1')).toEqual(['video-1', 'audio-1']);
  });

  it('falls back to legacy synced video/audio pairs', () => {
    const items = [
      makeItem({ id: 'video-1', type: 'video', originId: 'origin-1' }),
      makeItem({ id: 'audio-1', type: 'audio', originId: 'origin-1' }),
      makeItem({ id: 'audio-2', type: 'audio', originId: 'origin-1', from: 10 }),
    ];

    expect(getLinkedItemIds(items, 'video-1')).toEqual(['video-1', 'audio-1']);
  });

  it('expands mixed selections with linked companions', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video' }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio' }),
      makeItem({ id: 'video-2', type: 'video' }),
    ];

    expect(expandSelectionWithLinkedItems(items, ['video-1', 'video-2'])).toEqual(['video-1', 'audio-1', 'video-2']);
  });

  it('dedupes linked groups down to one split anchor', () => {
    const items = [
      makeItem({ id: 'comp-video-1', linkedGroupId: 'group-1', type: 'composition', compositionId: 'comp-1' }),
      makeItem({ id: 'comp-audio-1', linkedGroupId: 'group-1', type: 'audio', compositionId: 'comp-1', src: '' }),
      makeItem({ id: 'video-2', linkedGroupId: 'group-2', type: 'video' }),
      makeItem({ id: 'audio-2', linkedGroupId: 'group-2', type: 'audio' }),
    ];

    expect(getUniqueLinkedItemAnchorIds(items, ['comp-video-1', 'comp-audio-1', 'video-2', 'audio-2'])).toEqual([
      'comp-video-1',
      'video-2',
    ]);
  });

  it('validates linkable audio/video pairs', () => {
    const video = makeItem({ id: 'video-1', type: 'video', mediaId: 'media-1', from: 12, durationInFrames: 48 });
    const audio = makeItem({ id: 'audio-1', type: 'audio', mediaId: 'media-1', from: 12, durationInFrames: 48 });
    const shiftedAudio = makeItem({ id: 'audio-2', type: 'audio', mediaId: 'media-1', from: 18, durationInFrames: 48 });

    expect(canLinkItems([video, audio])).toBe(true);
    expect(canLinkItems([video, shiftedAudio])).toBe(false);
    expect(hasLinkedItems([
      { ...video, linkedGroupId: 'group-1' },
      { ...audio, linkedGroupId: 'group-1' },
    ], 'video-1')).toBe(true);
  });

  it('allows linking arbitrary multi-selection groups', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'video-1', type: 'video' }),
      makeItem({ id: 'audio-1', linkedGroupId: 'audio-1', type: 'audio' }),
      makeItem({ id: 'video-2', linkedGroupId: 'video-2', type: 'video', from: 100, mediaId: 'media-2', originId: 'origin-2' }),
    ];

    expect(canLinkSelection(items, ['video-1', 'audio-1', 'video-2'])).toBe(true);
  });

  it('allows linking a selected clip with an existing linked group', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video' }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio' }),
      makeItem({ id: 'video-2', linkedGroupId: 'video-2', type: 'video', from: 100, mediaId: 'media-2', originId: 'origin-2' }),
    ];

    expect(canLinkSelection(items, ['video-1', 'video-2'])).toBe(true);
  });

  it('blocks relinking a selection that is already one linked group', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video' }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio' }),
    ];

    expect(canLinkSelection(items, ['video-1', 'audio-1'])).toBe(false);
  });

  it('reports opposing sync offsets when linked clips move independently', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video', from: 0, sourceStart: 0, sourceFps: 30 }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio', from: 10, sourceStart: 0, sourceFps: 30 }),
    ];

    expect(getLinkedSyncOffsetFrames(items, 'video-1', 30)).toBe(-10);
    expect(getLinkedSyncOffsetFrames(items, 'audio-1', 30)).toBe(10);
  });

  it('reports sync offsets when linked clips are slipped apart', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video', from: 0, sourceStart: 12, sourceFps: 30 }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio', from: 0, sourceStart: 0, sourceFps: 30 }),
    ];

    expect(getLinkedSyncOffsetFrames(items, 'video-1', 30)).toBe(-12);
    expect(getLinkedSyncOffsetFrames(items, 'audio-1', 30)).toBe(12);
  });

  it('ignores unrelated clips in a larger linked group when computing sync badges', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video', from: 0, sourceStart: 0, sourceFps: 30 }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio', from: 0, sourceStart: 0, sourceFps: 30 }),
      makeItem({ id: 'video-2', linkedGroupId: 'group-1', type: 'video', from: 120, sourceStart: 0, sourceFps: 30, mediaId: 'media-2', originId: 'origin-2' }),
    ];

    expect(getLinkedSyncOffsetFrames(items, 'video-1', 30)).toBe(null);
    expect(getLinkedSyncOffsetFrames(items, 'audio-1', 30)).toBe(null);
  });

  it('still reports the actual audio-video drift inside a larger linked group', () => {
    const items = [
      makeItem({ id: 'video-1', linkedGroupId: 'group-1', type: 'video', from: 0, sourceStart: 0, sourceFps: 30 }),
      makeItem({ id: 'audio-1', linkedGroupId: 'group-1', type: 'audio', from: 10, sourceStart: 0, sourceFps: 30 }),
      makeItem({ id: 'video-2', linkedGroupId: 'group-1', type: 'video', from: 120, sourceStart: 0, sourceFps: 30, mediaId: 'media-2', originId: 'origin-2' }),
    ];

    expect(getLinkedSyncOffsetFrames(items, 'video-1', 30)).toBe(-10);
    expect(getLinkedSyncOffsetFrames(items, 'audio-1', 30)).toBe(10);
  });
});
