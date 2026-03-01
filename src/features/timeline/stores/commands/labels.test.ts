import { describe, expect, it } from 'vitest';
import { formatTimelineCommandLabel } from './labels';

describe('formatTimelineCommandLabel', () => {
  it('formats transform move labels with count', () => {
    const label = formatTimelineCommandLabel({
      type: 'UPDATE_TRANSFORMS',
      payload: { operation: 'move', count: 3 },
    });

    expect(label).toBe('Move 3 items');
  });

  it('formats transform fallback for single item', () => {
    const label = formatTimelineCommandLabel({
      type: 'UPDATE_TRANSFORM',
      payload: { id: 'item-1' },
    });

    expect(label).toBe('Transform item');
  });

  it('formats auto-keyframe label', () => {
    const label = formatTimelineCommandLabel({
      type: 'APPLY_AUTO_KEYFRAME_OPERATIONS',
      payload: { count: 2 },
    });

    expect(label).toBe('Auto-keyframe 2 properties');
  });

  it('falls back to title-cased command type', () => {
    const label = formatTimelineCommandLabel({
      type: 'MOVE_ITEMS',
      payload: { count: 4 },
    });

    expect(label).toBe('Move Items (4)');
  });
});

