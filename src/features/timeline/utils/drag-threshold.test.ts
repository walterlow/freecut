import { describe, expect, it } from 'vitest';
import { hasExceededDragThreshold } from './drag-threshold';

describe('hasExceededDragThreshold', () => {
  it('does not activate when movement stays within the threshold', () => {
    expect(hasExceededDragThreshold(100, 200, 102, 202, 3)).toBe(false);
  });

  it('activates once horizontal movement exceeds the threshold', () => {
    expect(hasExceededDragThreshold(100, 200, 104, 200, 3)).toBe(true);
  });

  it('activates once vertical movement exceeds the threshold', () => {
    expect(hasExceededDragThreshold(100, 200, 100, 204, 3)).toBe(true);
  });
});
