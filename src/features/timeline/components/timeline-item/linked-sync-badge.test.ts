import { describe, expect, it } from 'vitest';
import { shouldSuppressLinkedSyncBadge } from './linked-sync-badge';

function createParams(overrides: Partial<Parameters<typeof shouldSuppressLinkedSyncBadge>[0]> = {}) {
  return {
    linkedSelectionEnabled: true,
    linkedEditPreviewActive: false,
    isDragging: false,
    isPartOfDrag: false,
    isTrimming: false,
    isStretching: false,
    isSlipSlideActive: false,
    rollingEditDelta: 0,
    rippleEditOffset: 0,
    rippleEdgeDelta: 0,
    slipEditDelta: 0,
    slideEditOffset: 0,
    slideNeighborDelta: 0,
    ...overrides,
  };
}

describe('shouldSuppressLinkedSyncBadge', () => {
  it('does not suppress when linked selection is off', () => {
    expect(shouldSuppressLinkedSyncBadge(createParams({ linkedSelectionEnabled: false, isTrimming: true }))).toBe(false);
  });

  it('does not suppress when no linked tool preview is active', () => {
    expect(shouldSuppressLinkedSyncBadge(createParams())).toBe(false);
  });

  it('does not suppress during move drags', () => {
    expect(shouldSuppressLinkedSyncBadge(createParams({ isDragging: true }))).toBe(false);
    expect(shouldSuppressLinkedSyncBadge(createParams({ isPartOfDrag: true }))).toBe(false);
    expect(shouldSuppressLinkedSyncBadge(createParams({ isDragging: true, linkedEditPreviewActive: true }))).toBe(false);
  });

  it('suppresses for all linked tool preview paths', () => {
    expect(shouldSuppressLinkedSyncBadge(createParams({ linkedEditPreviewActive: true }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ isTrimming: true }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ isStretching: true }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ isSlipSlideActive: true }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ rollingEditDelta: 1 }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ rippleEditOffset: 1 }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ rippleEdgeDelta: 1 }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ slipEditDelta: 1 }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ slideEditOffset: 1 }))).toBe(true);
    expect(shouldSuppressLinkedSyncBadge(createParams({ slideNeighborDelta: 1 }))).toBe(true);
  });
});
