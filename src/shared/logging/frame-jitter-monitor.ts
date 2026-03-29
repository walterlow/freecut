/**
 * Frame Jitter Monitor — DEV-only instrumentation for detecting playback stalls
 *
 * Tracks frame-to-frame timing at two levels:
 *   1. Clock level  — time between consecutive `framechange` emissions
 *   2. Render level — time between consecutive frame presentations (rAF pump)
 *
 * Exposes results on `window.__FRAME_JITTER__` for console inspection.
 *
 * Usage (browser console):
 *   __FRAME_JITTER__.dump()        — summary table
 *   __FRAME_JITTER__.stalls        — all detected stalls
 *   __FRAME_JITTER__.transitions   — transition-area frame log
 *   __FRAME_JITTER__.reset()       — clear accumulated data
 *   __FRAME_JITTER__.histogram()   — frame time distribution
 */

export interface FrameTimingSample {
  frame: number;
  /** ms since previous sample */
  deltaMs: number;
  /** wall-clock timestamp (performance.now) */
  ts: number;
  /** whether this frame falls inside a transition window */
  inTransition: boolean;
  /** source: 'clock' | 'render' */
  source: 'clock' | 'render';
}

export interface StallEvent {
  frame: number;
  deltaMs: number;
  expectedMs: number;
  ratio: number;
  ts: number;
  source: 'clock' | 'render';
  inTransition: boolean;
}

export interface TransitionFrameLog {
  frame: number;
  renderMs: number;
  clockDeltaMs: number | null;
  renderDeltaMs: number | null;
  transitionId: string | null;
  progress: number | null;
}

const MAX_SAMPLES = 600;
const MAX_STALLS = 200;
const MAX_TRANSITION_LOG = 300;
const STALL_THRESHOLD_RATIO = 1.8;

function createMonitor() {
  let fps = 30;
  let expectedFrameMs = 1000 / fps;

  const clockSamples: FrameTimingSample[] = [];
  const renderSamples: FrameTimingSample[] = [];
  const stalls: StallEvent[] = [];
  const transitionLog: TransitionFrameLog[] = [];

  let lastClockTs = 0;
  let lastClockFrame = -1;
  let lastRenderTs = 0;
  let lastRenderFrame = -1;
  let isRecording = true;

  function setFps(newFps: number) {
    fps = newFps;
    expectedFrameMs = 1000 / fps;
  }

  function recordClockFrame(frame: number, inTransition: boolean) {
    if (!isRecording) return;
    const now = performance.now();
    if (lastClockTs > 0 && frame !== lastClockFrame) {
      const deltaMs = now - lastClockTs;
      const sample: FrameTimingSample = {
        frame,
        deltaMs,
        ts: now,
        inTransition,
        source: 'clock',
      };
      if (clockSamples.length >= MAX_SAMPLES) clockSamples.shift();
      clockSamples.push(sample);

      if (deltaMs > expectedFrameMs * STALL_THRESHOLD_RATIO) {
        const stall: StallEvent = {
          frame,
          deltaMs,
          expectedMs: expectedFrameMs,
          ratio: deltaMs / expectedFrameMs,
          ts: now,
          source: 'clock',
          inTransition,
        };
        if (stalls.length >= MAX_STALLS) stalls.shift();
        stalls.push(stall);
      }
    }
    lastClockTs = now;
    lastClockFrame = frame;
  }

  function recordRenderFrame(
    frame: number,
    renderMs: number,
    inTransition: boolean,
    transitionId: string | null,
    transitionProgress: number | null,
  ) {
    if (!isRecording) return;
    const now = performance.now();
    if (lastRenderTs > 0 && frame !== lastRenderFrame) {
      const deltaMs = now - lastRenderTs;
      const sample: FrameTimingSample = {
        frame,
        deltaMs,
        ts: now,
        inTransition,
        source: 'render',
      };
      if (renderSamples.length >= MAX_SAMPLES) renderSamples.shift();
      renderSamples.push(sample);

      if (deltaMs > expectedFrameMs * STALL_THRESHOLD_RATIO) {
        const stall: StallEvent = {
          frame,
          deltaMs,
          expectedMs: expectedFrameMs,
          ratio: deltaMs / expectedFrameMs,
          ts: now,
          source: 'render',
          inTransition,
        };
        if (stalls.length >= MAX_STALLS) stalls.shift();
        stalls.push(stall);
      }
    }
    lastRenderTs = now;
    lastRenderFrame = frame;

    if (inTransition || transitionId) {
      const entry: TransitionFrameLog = {
        frame,
        renderMs,
        clockDeltaMs: clockSamples.length > 0
          ? clockSamples[clockSamples.length - 1]!.deltaMs
          : null,
        renderDeltaMs: renderSamples.length > 0
          ? renderSamples[renderSamples.length - 1]!.deltaMs
          : null,
        transitionId,
        progress: transitionProgress,
      };
      if (transitionLog.length >= MAX_TRANSITION_LOG) transitionLog.shift();
      transitionLog.push(entry);
    }
  }

  function onPlaybackStart() {
    lastClockTs = 0;
    lastClockFrame = -1;
    lastRenderTs = 0;
    lastRenderFrame = -1;
  }

  function reset() {
    clockSamples.length = 0;
    renderSamples.length = 0;
    stalls.length = 0;
    transitionLog.length = 0;
    lastClockTs = 0;
    lastClockFrame = -1;
    lastRenderTs = 0;
    lastRenderFrame = -1;
  }

  function computeStats(samples: FrameTimingSample[]) {
    if (samples.length < 2) return null;
    const deltas = samples.map((s) => s.deltaMs);
    const sorted = [...deltas].sort((a, b) => a - b);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
    const stdDev = Math.sqrt(variance);
    const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const jitter = stdDev / mean;
    return { mean, stdDev, jitter, p50, p95, p99, min, max, count: samples.length };
  }

  function dump() {
    const clockStats = computeStats(clockSamples);
    const renderStats = computeStats(renderSamples);
    const transitionStalls = stalls.filter((s) => s.inTransition);

    /* eslint-disable no-console */
    console.group('%c Frame Jitter Report', 'font-weight:bold;font-size:14px;color:#60a5fa');
    console.log(`FPS: ${fps}, Expected frame: ${expectedFrameMs.toFixed(1)}ms`);

    if (clockStats) {
      console.group('Clock frame intervals');
      console.table({
        'Mean (ms)': clockStats.mean.toFixed(2),
        'Std Dev': clockStats.stdDev.toFixed(2),
        'Jitter (CV)': (clockStats.jitter * 100).toFixed(1) + '%',
        'P50': clockStats.p50.toFixed(1),
        'P95': clockStats.p95.toFixed(1),
        'P99': clockStats.p99.toFixed(1),
        'Min': clockStats.min.toFixed(1),
        'Max': clockStats.max.toFixed(1),
        'Samples': clockStats.count,
      });
      console.groupEnd();
    }

    if (renderStats) {
      console.group('Render frame intervals');
      console.table({
        'Mean (ms)': renderStats.mean.toFixed(2),
        'Std Dev': renderStats.stdDev.toFixed(2),
        'Jitter (CV)': (renderStats.jitter * 100).toFixed(1) + '%',
        'P50': renderStats.p50.toFixed(1),
        'P95': renderStats.p95.toFixed(1),
        'P99': renderStats.p99.toFixed(1),
        'Min': renderStats.min.toFixed(1),
        'Max': renderStats.max.toFixed(1),
        'Samples': renderStats.count,
      });
      console.groupEnd();
    }

    console.log(`Total stalls: ${stalls.length} (${transitionStalls.length} in transitions)`);
    if (stalls.length > 0) {
      console.group('Stalls (>1.8x expected)');
      console.table(stalls.slice(-20).map((s) => ({
        frame: s.frame,
        'delta (ms)': s.deltaMs.toFixed(1),
        'ratio': s.ratio.toFixed(1) + 'x',
        source: s.source,
        transition: s.inTransition ? 'YES' : '',
      })));
      console.groupEnd();
    }

    if (transitionLog.length > 0) {
      console.group(`Transition frames (${transitionLog.length})`);
      console.table(transitionLog.slice(-30).map((t) => ({
        frame: t.frame,
        'render (ms)': t.renderMs.toFixed(1),
        'clock delta': t.clockDeltaMs?.toFixed(1) ?? '-',
        'render delta': t.renderDeltaMs?.toFixed(1) ?? '-',
        progress: t.progress?.toFixed(3) ?? '-',
        transitionId: t.transitionId?.slice(0, 8) ?? '-',
      })));
      console.groupEnd();
    }
    console.groupEnd();
    /* eslint-enable no-console */
  }

  function histogram() {
    const allSamples = [...clockSamples, ...renderSamples];
    if (allSamples.length === 0) {
      /* eslint-disable no-console */
      console.log('No samples recorded yet');
      /* eslint-enable no-console */
      return;
    }
    const buckets = new Map<string, number>();
    for (const s of allSamples) {
      const bucket = Math.floor(s.deltaMs / 4) * 4;
      const key = `${bucket}-${bucket + 4}ms`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const sorted = [...buckets.entries()].sort((a, b) => {
      return parseInt(a[0]) - parseInt(b[0]);
    });
    /* eslint-disable no-console */
    console.group('Frame time histogram (4ms buckets)');
    for (const [range, count] of sorted) {
      const bar = '\u2588'.repeat(Math.min(count, 80));
      console.log(`${range.padStart(12)} | ${bar} (${count})`);
    }
    console.groupEnd();
    /* eslint-enable no-console */
  }

  return {
    setFps,
    recordClockFrame,
    recordRenderFrame,
    onPlaybackStart,
    reset,
    dump,
    histogram,
    get stalls() { return stalls; },
    get clockSamples() { return clockSamples; },
    get renderSamples() { return renderSamples; },
    get transitions() { return transitionLog; },
    get isRecording() { return isRecording; },
    set isRecording(v: boolean) { isRecording = v; },
  };
}

export type FrameJitterMonitor = ReturnType<typeof createMonitor>;

let _instance: FrameJitterMonitor | null = null;

export function getFrameJitterMonitor(): FrameJitterMonitor {
  if (!_instance) {
    _instance = createMonitor();
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__FRAME_JITTER__ = _instance;
    }
  }
  return _instance;
}
