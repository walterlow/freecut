import { describe, expect, it } from 'vitest';
import { getSourceWarmTarget } from './source-warm-target';

const baseInput = {
  currentPoolSourceCount: 12,
  currentPoolElementCount: 20,
  maxSources: 20,
  minSources: 4,
  hardCapSources: 24,
  hardCapElements: 40,
} as const;

describe('getSourceWarmTarget', () => {
  it('uses the highest budget while playing when under pressure limits', () => {
    const target = getSourceWarmTarget({
      ...baseInput,
      mode: 'playing',
    });
    expect(target).toBe(20);
  });

  it('reduces mode budgets for scrubbing and paused states', () => {
    const scrubbingTarget = getSourceWarmTarget({
      ...baseInput,
      mode: 'scrubbing',
    });
    const pausedTarget = getSourceWarmTarget({
      ...baseInput,
      mode: 'paused',
    });
    expect(scrubbingTarget).toBe(16);
    expect(pausedTarget).toBe(12);
  });

  it('applies source-count pressure above hard cap', () => {
    const target = getSourceWarmTarget({
      ...baseInput,
      mode: 'playing',
      currentPoolSourceCount: 30,
    });
    // Base 20 minus 6 over-source pressure.
    expect(target).toBe(14);
  });

  it('applies element-count pressure above hard cap', () => {
    const target = getSourceWarmTarget({
      ...baseInput,
      mode: 'playing',
      currentPoolElementCount: 46,
    });
    // 6 elements over cap -> ceil(6 / 2) = 3 pressure.
    expect(target).toBe(17);
  });

  it('never drops below minSources under extreme pressure', () => {
    const target = getSourceWarmTarget({
      ...baseInput,
      mode: 'playing',
      currentPoolSourceCount: 400,
      currentPoolElementCount: 400,
    });
    expect(target).toBe(4);
  });
});
