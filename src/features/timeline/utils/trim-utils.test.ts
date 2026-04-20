import { describe, it, expect, beforeEach } from 'vitest';
import { clampToAdjacentItems, clampTrimAmount, calculateTrimSourceUpdate } from './trim-utils';
import { useCompositionsStore } from '../stores/compositions-store';
import type { TimelineItem } from '@/types/timeline';

function makeItem(overrides: Partial<TimelineItem> & { id: string; trackId: string; from: number; durationInFrames: number }): TimelineItem {
  return {
    type: 'image',
    label: 'test',
    src: '',
    ...overrides,
  } as TimelineItem;
}

describe('clampToAdjacentItems', () => {
  const trackId = 'track-1';

  describe('end handle (extending right)', () => {
    it('passes through when no neighbors exist', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const result = clampToAdjacentItems(item, 'end', 50, [item]);
      expect(result).toBe(50);
    });

    it('clamps to gap before next item', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 120, durationInFrames: 50 });
      // Gap is 20 frames, requesting 50
      const result = clampToAdjacentItems(item, 'end', 50, [item, neighbor]);
      expect(result).toBe(20);
    });

    it('returns 0 when neighbor is exactly touching', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 100, durationInFrames: 50 });
      const result = clampToAdjacentItems(item, 'end', 10, [item, neighbor]);
      expect(result).toBe(0);
    });

    it('passes through when trimAmount fits within gap', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 150, durationInFrames: 50 });
      // Gap is 50, requesting 30
      const result = clampToAdjacentItems(item, 'end', 30, [item, neighbor]);
      expect(result).toBe(30);
    });

    it('picks the nearest neighbor when multiple exist', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const far = makeItem({ id: 'b', trackId, from: 200, durationInFrames: 50 });
      const near = makeItem({ id: 'c', trackId, from: 110, durationInFrames: 50 });
      // Nearest gap is 10
      const result = clampToAdjacentItems(item, 'end', 50, [item, far, near]);
      expect(result).toBe(10);
    });

    it('ignores items on different tracks', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const otherTrack = makeItem({ id: 'b', trackId: 'track-2', from: 100, durationInFrames: 50 });
      const result = clampToAdjacentItems(item, 'end', 50, [item, otherTrack]);
      expect(result).toBe(50);
    });
  });

  describe('start handle (extending left)', () => {
    it('passes through when no neighbors exist to the left', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const result = clampToAdjacentItems(item, 'start', -50, [item]);
      expect(result).toBe(-50);
    });

    it('clamps to gap after previous item', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 80 });
      // Gap is 20 frames, requesting -50
      const result = clampToAdjacentItems(item, 'start', -50, [item, neighbor]);
      expect(result).toBe(-20);
    });

    it('returns 0 when neighbor is exactly touching', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 100 });
      const result = clampToAdjacentItems(item, 'start', -10, [item, neighbor]);
      expect(result).toBe(0);
    });

    it('passes through when trimAmount fits within gap', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 50 });
      // Gap is 50, requesting -30
      const result = clampToAdjacentItems(item, 'start', -30, [item, neighbor]);
      expect(result).toBe(-30);
    });

    it('ignores items on different tracks', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const otherTrack = makeItem({ id: 'b', trackId: 'track-2', from: 50, durationInFrames: 100 });
      const result = clampToAdjacentItems(item, 'start', -80, [item, otherTrack]);
      expect(result).toBe(-80);
    });
  });

  describe('clampTrimAmount for composition items', () => {
    beforeEach(() => {
      useCompositionsStore.setState({
        compositions: [],
        compositionById: {},
        mediaDependencyIds: [],
        mediaDependencyVersion: 0,
      });
    });

    it('uses live sub-comp duration instead of stale cached sourceDuration when extending', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-1',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      });

      const wrapper = {
        type: 'composition',
        id: 'wrap-1',
        trackId,
        compositionId: 'sub-1',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem;

      const result = clampTrimAmount(wrapper, 'end', 3000, 30);
      expect(result.clampedAmount).toBe(3000);
      expect(result.maxExtend).toBe(10800 - 3902);
    });

    it('uses live sub-comp duration for composition audio wrapper (type=audio with compositionId)', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-audio',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      });

      const audioWrapper = {
        type: 'audio',
        id: 'wrap-audio',
        trackId,
        compositionId: 'sub-audio',
        linkedGroupId: 'lg-1',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem;

      const result = clampTrimAmount(audioWrapper, 'end', 3000, 30);
      expect(result.clampedAmount).toBe(3000);
      expect(result.maxExtend).toBe(10800 - 3902);
    });

    it('calculateTrimSourceUpdate respects live sub-comp duration when clamping sourceEnd', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-2',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      });

      const wrapper = {
        type: 'composition',
        id: 'wrap-2',
        trackId,
        compositionId: 'sub-2',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem;

      const update = calculateTrimSourceUpdate(wrapper, 'end', 3000, 6902, 30);
      expect(update?.sourceEnd).toBe(6902);
    });
  });

  describe('shrinking (no clamping needed)', () => {
    it('passes through end handle shrinking (negative trimAmount)', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 100, durationInFrames: 50 });
      const result = clampToAdjacentItems(item, 'end', -20, [item, neighbor]);
      expect(result).toBe(-20);
    });

    it('passes through start handle shrinking (positive trimAmount)', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 });
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 100 });
      const result = clampToAdjacentItems(item, 'start', 20, [item, neighbor]);
      expect(result).toBe(20);
    });
  });
});
