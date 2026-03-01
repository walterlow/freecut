export type PreviewRenderSource = 'player' | 'fast_scrub_overlay';

export interface RenderSourceSwitchEntry {
  ts: number;
  atFrame: number;
  from: PreviewRenderSource;
  to: PreviewRenderSource;
}

export interface SeekLatencyStats {
  samples: number;
  totalMs: number;
  lastMs: number;
  timeouts: number;
}

export function recordSeekLatency(
  stats: SeekLatencyStats,
  latencyMs: number
): SeekLatencyStats {
  return {
    ...stats,
    samples: stats.samples + 1,
    totalMs: stats.totalMs + latencyMs,
    lastMs: latencyMs,
  };
}

export function recordSeekLatencyTimeout(stats: SeekLatencyStats): SeekLatencyStats {
  return {
    ...stats,
    timeouts: stats.timeouts + 1,
  };
}

export function pushRenderSourceSwitchHistory(
  history: RenderSourceSwitchEntry[],
  entry: RenderSourceSwitchEntry,
  maxEntries: number
): RenderSourceSwitchEntry[] {
  if (maxEntries <= 0) return [];
  if (history.length < maxEntries) return [...history, entry];
  return [...history.slice(history.length - maxEntries + 1), entry];
}
