import { describe, expect, it } from 'vitest';
import {
  pushRenderSourceSwitchHistory,
  recordSeekLatency,
  recordSeekLatencyTimeout,
  type SeekLatencyStats,
} from './preview-perf-metrics';

describe('recordSeekLatency', () => {
  it('increments samples and totals', () => {
    const initial: SeekLatencyStats = {
      samples: 1,
      totalMs: 40,
      lastMs: 40,
      timeouts: 0,
    };
    const next = recordSeekLatency(initial, 25);

    expect(next).toEqual({
      samples: 2,
      totalMs: 65,
      lastMs: 25,
      timeouts: 0,
    });
  });
});

describe('recordSeekLatencyTimeout', () => {
  it('increments timeout count', () => {
    const initial: SeekLatencyStats = {
      samples: 0,
      totalMs: 0,
      lastMs: 0,
      timeouts: 2,
    };
    const next = recordSeekLatencyTimeout(initial);
    expect(next.timeouts).toBe(3);
  });
});

describe('pushRenderSourceSwitchHistory', () => {
  it('appends when under capacity', () => {
    const next = pushRenderSourceSwitchHistory(
      [],
      { ts: 1, atFrame: 10, from: 'renderer', to: 'renderer' },
      3
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ ts: 1, atFrame: 10, from: 'renderer', to: 'renderer' });
  });

  it('keeps only the most recent entries at capacity', () => {
    const next = pushRenderSourceSwitchHistory(
      [
        { ts: 1, atFrame: 0, from: 'renderer', to: 'renderer' },
        { ts: 2, atFrame: 1, from: 'renderer', to: 'renderer' },
        { ts: 3, atFrame: 2, from: 'renderer', to: 'renderer' },
      ],
      { ts: 4, atFrame: 3, from: 'renderer', to: 'renderer' },
      3
    );
    expect(next).toEqual([
      { ts: 2, atFrame: 1, from: 'renderer', to: 'renderer' },
      { ts: 3, atFrame: 2, from: 'renderer', to: 'renderer' },
      { ts: 4, atFrame: 3, from: 'renderer', to: 'renderer' },
    ]);
  });

  it('returns empty when maxEntries is not positive', () => {
    const next = pushRenderSourceSwitchHistory(
      [{ ts: 1, atFrame: 0, from: 'renderer', to: 'renderer' }],
      { ts: 2, atFrame: 1, from: 'renderer', to: 'renderer' },
      0
    );
    expect(next).toEqual([]);
  });
});
