import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { getFilteredItemSnapEdges } from './timeline-snap-utils';

function makeItem(
  overrides: Partial<TimelineItem> & {
    id: string;
    trackId: string;
    from: number;
    durationInFrames: number;
  }
): TimelineItem {
  return {
    type: 'video',
    label: overrides.id,
    src: '',
    ...overrides,
  } as TimelineItem;
}

function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 't1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-1',
    durationInFrames: 20,
    ...overrides,
  };
}

describe('getFilteredItemSnapEdges', () => {
  it('includes transition midpoint for the right clip when not excluded', () => {
    const left = makeItem({ id: 'left', trackId: 'track-1', from: 0, durationInFrames: 100 });
    const right = makeItem({ id: 'right', trackId: 'track-1', from: 90, durationInFrames: 80 });

    const edges = getFilteredItemSnapEdges(
      [left, right],
      [makeTransition()],
      new Set(['track-1'])
    );

    expect(edges).toContainEqual({ frame: 100, type: 'item-start', itemId: 'right' });
  });

  it('does not include transition midpoint or edges for excluded right clip', () => {
    const left = makeItem({ id: 'left', trackId: 'track-1', from: 0, durationInFrames: 100 });
    const right = makeItem({ id: 'right', trackId: 'track-1', from: 90, durationInFrames: 80 });

    const edges = getFilteredItemSnapEdges(
      [left, right],
      [makeTransition()],
      new Set(['track-1']),
      ['right']
    );

    expect(edges.some((edge) => edge.itemId === 'right')).toBe(false);
    expect(edges).toEqual([{ frame: 0, type: 'item-start', itemId: 'left' }]);
  });

  it('does not include transition midpoint when left clip is excluded', () => {
    const left = makeItem({ id: 'left', trackId: 'track-1', from: 0, durationInFrames: 100 });
    const right = makeItem({ id: 'right', trackId: 'track-1', from: 90, durationInFrames: 80 });

    const edges = getFilteredItemSnapEdges(
      [left, right],
      [makeTransition()],
      new Set(['track-1']),
      ['left']
    );

    expect(edges).not.toContainEqual({ frame: 100, type: 'item-start', itemId: 'right' });
  });

  // --- Regression tests for snap bugs discovered during ripple edit work ---

  describe('transition midpoint tagging', () => {
    it('tags transition midpoints with rightClipId so downstream exclusion can filter them', () => {
      const left = makeItem({ id: 'B', trackId: 'track-1', from: 100, durationInFrames: 100 });
      const right = makeItem({ id: 'C', trackId: 'track-1', from: 185, durationInFrames: 115 });
      const transition = makeTransition({
        leftClipId: 'B',
        rightClipId: 'C',
        durationInFrames: 15,
      });

      const edges = getFilteredItemSnapEdges(
        [left, right],
        [transition],
        new Set(['track-1'])
      );

      // Midpoint = rightClip.from + ceil(15/2) = 185 + 8 = 193
      const midpoint = edges.find((e) => e.frame === 193);
      expect(midpoint).toBeDefined();
      expect(midpoint!.itemId).toBe('C');
    });

    it('allows runtime exclusion of transition midpoints via itemId match', () => {
      const left = makeItem({ id: 'B', trackId: 'track-1', from: 100, durationInFrames: 100 });
      const right = makeItem({ id: 'C', trackId: 'track-1', from: 185, durationInFrames: 115 });
      const transition = makeTransition({
        leftClipId: 'B',
        rightClipId: 'C',
        durationInFrames: 15,
      });

      const edges = getFilteredItemSnapEdges(
        [left, right],
        [transition],
        new Set(['track-1'])
      );

      // Simulate the runtime exclusion that findSnapForFrame performs
      const excludeIds = new Set(['C']);
      const filtered = edges.filter(
        (e) => !(e.itemId && excludeIds.has(e.itemId))
      );

      expect(filtered.every((e) => e.itemId !== 'C')).toBe(true);
      // The midpoint (tagged with C) should be gone
      expect(filtered.find((e) => e.frame === 193)).toBeUndefined();
    });
  });

  describe('transition overlap model — downstream detection', () => {
    it('transition neighbor with from < trimmed clip end is excluded when right clip is in excludeItemIds', () => {
      // B[100-200] with transition to C[185-300] (15-frame overlap)
      // During ripple edit on B, C should be excludable even though C.from < B.end
      const B = makeItem({ id: 'B', trackId: 'track-1', from: 100, durationInFrames: 100 });
      const C = makeItem({ id: 'C', trackId: 'track-1', from: 185, durationInFrames: 115 });
      const transition = makeTransition({
        leftClipId: 'B',
        rightClipId: 'C',
        durationInFrames: 15,
      });

      const edges = getFilteredItemSnapEdges(
        [B, C],
        [transition],
        new Set(['track-1']),
        ['C']  // exclude C (the transition-connected downstream neighbor)
      );

      // No edges from C should remain (its start is suppressed by transition,
      // its end and the midpoint should be filtered by the exclude)
      expect(edges.every((e) => e.itemId !== 'C')).toBe(true);
    });

    it('excludes transition midpoint when either clip is excluded', () => {
      const B = makeItem({ id: 'B', trackId: 'track-1', from: 100, durationInFrames: 100 });
      const C = makeItem({ id: 'C', trackId: 'track-1', from: 185, durationInFrames: 115 });
      const transition = makeTransition({
        leftClipId: 'B',
        rightClipId: 'C',
        durationInFrames: 15,
      });

      // Exclude B (left clip of transition)
      const edgesExcludeLeft = getFilteredItemSnapEdges(
        [B, C],
        [transition],
        new Set(['track-1']),
        ['B']
      );
      expect(edgesExcludeLeft.find((e) => e.frame === 193)).toBeUndefined();

      // Exclude C (right clip of transition)
      const edgesExcludeRight = getFilteredItemSnapEdges(
        [B, C],
        [transition],
        new Set(['track-1']),
        ['C']
      );
      expect(edgesExcludeRight.find((e) => e.frame === 193)).toBeUndefined();
    });
  });

  describe('multi-track snap isolation', () => {
    it('includes edges from other visible tracks (cross-track snap targets are valid)', () => {
      const A = makeItem({ id: 'A', trackId: 'track-1', from: 0, durationInFrames: 100 });
      const D = makeItem({ id: 'D', trackId: 'track-2', from: 50, durationInFrames: 200 });

      const edges = getFilteredItemSnapEdges(
        [A, D],
        [],
        new Set(['track-1', 'track-2']),
        ['A']  // exclude A (being trimmed)
      );

      // D's edges should be present (cross-track, won't shift in single-track ripple)
      expect(edges).toContainEqual({ frame: 50, type: 'item-start', itemId: 'D' });
      expect(edges).toContainEqual({ frame: 250, type: 'item-end', itemId: 'D' });
    });

    it('excludes edges from hidden tracks', () => {
      const A = makeItem({ id: 'A', trackId: 'track-1', from: 0, durationInFrames: 100 });
      const hidden = makeItem({ id: 'H', trackId: 'track-hidden', from: 0, durationInFrames: 100 });

      const edges = getFilteredItemSnapEdges(
        [A, hidden],
        [],
        new Set(['track-1']),  // track-hidden not in visible set
      );

      expect(edges.every((e) => e.itemId !== 'H')).toBe(true);
    });
  });

  describe('split segment family — originId-based exclusion', () => {
    it('split siblings sharing originId can be excluded together at runtime', () => {
      // Simulates post-split: A[0-150] and B[150-300] from same source
      const A = makeItem({
        id: 'A', trackId: 'track-1', from: 0, durationInFrames: 150,
        originId: 'origin-1',
      } as Partial<TimelineItem> & { id: string; trackId: string; from: number; durationInFrames: number });
      const B = makeItem({
        id: 'B', trackId: 'track-1', from: 150, durationInFrames: 150,
        originId: 'origin-1',
      } as Partial<TimelineItem> & { id: string; trackId: string; from: number; durationInFrames: number });
      const unrelated = makeItem({ id: 'X', trackId: 'track-1', from: 400, durationInFrames: 50 });

      const edges = getFilteredItemSnapEdges(
        [A, B, unrelated],
        [],
        new Set(['track-1'])
      );

      // Simulate runtime originId-family exclusion (as done in use-timeline-trim)
      const excludeIds = new Set(['A', 'B']);
      const filtered = edges.filter(
        (e) => !(e.itemId && excludeIds.has(e.itemId))
      );

      // Only unrelated item edges remain
      expect(filtered).toEqual([
        { frame: 400, type: 'item-start', itemId: 'X' },
        { frame: 450, type: 'item-end', itemId: 'X' },
      ]);
    });
  });

  describe('downstream exclusion completeness', () => {
    it('all downstream same-track items can be excluded by ID', () => {
      // A[0-100], B[100-200] (being trimmed), C[200-300], D[300-400]
      const A = makeItem({ id: 'A', trackId: 'track-1', from: 0, durationInFrames: 100 });
      const B = makeItem({ id: 'B', trackId: 'track-1', from: 100, durationInFrames: 100 });
      const C = makeItem({ id: 'C', trackId: 'track-1', from: 200, durationInFrames: 100 });
      const D = makeItem({ id: 'D', trackId: 'track-1', from: 300, durationInFrames: 100 });
      // Cross-track item at same position — should NOT be excluded
      const E = makeItem({ id: 'E', trackId: 'track-2', from: 200, durationInFrames: 100 });

      const edges = getFilteredItemSnapEdges(
        [A, B, C, D, E],
        [],
        new Set(['track-1', 'track-2']),
        ['B']  // exclude trimmed item at generation time
      );

      // Simulate ripple downstream exclusion: C and D are downstream of B (from >= 200)
      const downstreamIds = new Set(['C', 'D']);
      const filtered = edges.filter(
        (e) => !(e.itemId && downstreamIds.has(e.itemId))
      );

      // A's edges remain (upstream)
      expect(filtered).toContainEqual({ frame: 0, type: 'item-start', itemId: 'A' });
      expect(filtered).toContainEqual({ frame: 100, type: 'item-end', itemId: 'A' });

      // E's edges remain (different track)
      expect(filtered).toContainEqual({ frame: 200, type: 'item-start', itemId: 'E' });
      expect(filtered).toContainEqual({ frame: 300, type: 'item-end', itemId: 'E' });

      // C and D edges are gone
      expect(filtered.every((e) => e.itemId !== 'C' && e.itemId !== 'D')).toBe(true);
    });
  });

  describe('transition edge suppression', () => {
    it('suppresses left clip end and right clip start in transition zone', () => {
      const left = makeItem({ id: 'left', trackId: 'track-1', from: 0, durationInFrames: 100 });
      const right = makeItem({ id: 'right', trackId: 'track-1', from: 80, durationInFrames: 120 });
      const transition = makeTransition({ durationInFrames: 20 });

      const edges = getFilteredItemSnapEdges(
        [left, right],
        [transition],
        new Set(['track-1'])
      );

      // Left clip end (100) should be suppressed
      expect(edges.find((e) => e.itemId === 'left' && e.type === 'item-end')).toBeUndefined();
      // Right clip original start (80) should be suppressed — but the
      // transition midpoint (90) tagged with 'right' is still present.
      expect(edges.find((e) => e.itemId === 'right' && e.frame === 80)).toBeUndefined();

      // Left clip start (0) should remain
      expect(edges).toContainEqual({ frame: 0, type: 'item-start', itemId: 'left' });
      // Right clip end (200) should remain
      expect(edges).toContainEqual({ frame: 200, type: 'item-end', itemId: 'right' });
    });
  });
});
