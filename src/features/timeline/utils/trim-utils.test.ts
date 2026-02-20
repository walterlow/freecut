import { describe, it, expect } from 'vitest';
import { clampToAdjacentItems } from './trim-utils';
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
