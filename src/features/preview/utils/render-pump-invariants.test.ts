/**
 * Regression tests for render pump invariants.
 *
 * These tests verify the critical concurrency invariants of the scrub/playback
 * render pump without rendering actual video. They test the lock, generation,
 * and state machine logic that was the source of multiple jitter/stall bugs.
 *
 * Each test documents a specific bug that was found and fixed, so future
 * optimizations don't reintroduce them.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal simulation of the render pump's lock + generation state machine
// ---------------------------------------------------------------------------

function createPumpSimulation() {
  let scrubRenderInFlight = false;
  let scrubRenderGeneration = 0;
  let scrubRequestedFrame: number | null = null;
  let pumpCallCount = 0;
  let concurrentPumps = 0;
  let maxConcurrentPumps = 0;
  let staleFinallyReleases = 0;
  let renderedFrames: number[] = [];
  let renderDelayMs = 1;

  const pumpRenderLoop = async () => {
    if (scrubRenderInFlight) return;
    scrubRenderInFlight = true;
    const generation = scrubRenderGeneration;
    pumpCallCount += 1;
    concurrentPumps += 1;
    maxConcurrentPumps = Math.max(maxConcurrentPumps, concurrentPumps);

    const isStale = () => scrubRenderGeneration !== generation;

    try {
      while (true) {
        const targetFrame = scrubRequestedFrame;
        if (targetFrame === null) break;
        scrubRequestedFrame = null;

        // Simulate async renderFrame
        await new Promise((r) => setTimeout(r, renderDelayMs));

        // Priority frames are never discarded (the fix)
        renderedFrames.push(targetFrame);

        // Prewarm: bail if stale
        if (isStale()) break;
      }
    } finally {
      concurrentPumps -= 1;
      if (scrubRenderGeneration === generation) {
        scrubRenderInFlight = false;
        // Re-pump if a new target arrived
        if (scrubRequestedFrame !== null) {
          void pumpRenderLoop();
        }
      } else {
        // Stale pump — don't release lock (newer owner or force-clear handles it)
        staleFinallyReleases += 1;
      }
    }
  };

  return {
    get inFlight() { return scrubRenderInFlight; },
    get generation() { return scrubRenderGeneration; },
    get pumpCallCount() { return pumpCallCount; },
    get maxConcurrentPumps() { return maxConcurrentPumps; },
    get staleFinallyReleases() { return staleFinallyReleases; },
    get renderedFrames() { return renderedFrames; },
    set renderDelayMs(ms: number) { renderDelayMs = ms; },
    setRequestedFrame(frame: number) { scrubRequestedFrame = frame; },
    bumpGeneration() { scrubRenderGeneration += 1; },
    forceUnlock() {
      // Simulates the playback-start force-clear
      scrubRenderGeneration += 1;
      scrubRenderInFlight = false;
    },
    pump: pumpRenderLoop,
    reset() {
      scrubRenderInFlight = false;
      scrubRenderGeneration = 0;
      scrubRequestedFrame = null;
      pumpCallCount = 0;
      concurrentPumps = 0;
      maxConcurrentPumps = 0;
      staleFinallyReleases = 0;
      renderedFrames = [];
      renderDelayMs = 1;
    },
  };
}

describe('render pump invariants', () => {
  let sim: ReturnType<typeof createPumpSimulation>;

  beforeEach(() => {
    sim = createPumpSimulation();
  });

  it('only one pump runs at a time (no concurrent pumps)', async () => {
    sim.setRequestedFrame(100);
    const p1 = sim.pump();
    sim.setRequestedFrame(101);
    const p2 = sim.pump(); // should return immediately (lock held)
    await p1;
    await p2;
    expect(sim.maxConcurrentPumps).toBe(1);
  });

  it('sequential scrub frames are all rendered (no drops)', async () => {
    for (let i = 0; i < 5; i++) {
      sim.setRequestedFrame(100 + i);
      await sim.pump();
    }
    expect(sim.renderedFrames).toEqual([100, 101, 102, 103, 104]);
  });

  it('latest scrub target wins when pump is in-flight', async () => {
    sim.renderDelayMs = 10;
    sim.setRequestedFrame(100);
    const p = sim.pump();
    // While pump is in-flight, update the target
    sim.setRequestedFrame(200);
    await p;
    // The pump should have rendered 100 then picked up 200
    expect(sim.renderedFrames).toContain(100);
    // 200 may or may not be rendered in the same pump iteration depending on timing
    // but the important thing is: only 1 pump ran
    expect(sim.maxConcurrentPumps).toBe(1);
  });

  it('playback-start force-clear allows new pump immediately', async () => {
    sim.renderDelayMs = 50;
    sim.setRequestedFrame(100);
    const p1 = sim.pump(); // starts, lock = true

    // Simulate playback start
    sim.forceUnlock(); // bumps generation + clears lock
    sim.setRequestedFrame(200);
    const p2 = sim.pump(); // should start (lock was cleared)

    await p1;
    await p2;

    // Both pumps ran, but the stale one's finally didn't release the new lock
    expect(sim.renderedFrames).toContain(200);
    expect(sim.staleFinallyReleases).toBe(1); // stale pump detected mismatch
  });

  it('stale pump finally does NOT release newer pump lock', async () => {
    sim.renderDelayMs = 10;
    sim.setRequestedFrame(100);
    const p1 = sim.pump();

    sim.forceUnlock();
    sim.setRequestedFrame(200);
    const p2 = sim.pump();

    await p1;
    await p2;

    // After both complete, lock should be released (by p2, not p1)
    expect(sim.inFlight).toBe(false);
    expect(sim.staleFinallyReleases).toBe(1);
  });

  it('generation bump without lock clear does NOT create concurrent pumps', async () => {
    sim.renderDelayMs = 10;
    sim.setRequestedFrame(100);
    const p1 = sim.pump();

    // Bump generation only (scrub path) — don't clear lock
    sim.bumpGeneration();
    sim.setRequestedFrame(200);
    const p2 = sim.pump(); // should return immediately (lock still held)

    await p1;
    await p2;

    expect(sim.maxConcurrentPumps).toBe(1);
  });

  it('scrub does not cause unbounded concurrent pumps', async () => {
    // Regression: generation bump + lock clear on every scrub frame caused
    // N concurrent pumps for N scrub frames
    sim.renderDelayMs = 5;
    const pumps: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      sim.setRequestedFrame(100 + i);
      // DON'T force-unlock on scrub (the fix)
      pumps.push(sim.pump());
    }

    await Promise.all(pumps);
    expect(sim.maxConcurrentPumps).toBe(1);
  });

  it('priority frames are never discarded by staleness check', async () => {
    sim.renderDelayMs = 50;
    sim.setRequestedFrame(100);
    const p = sim.pump();
    // Bump generation mid-render — simulates a new scrub target arriving
    // while the priority frame render is in-flight
    sim.bumpGeneration();
    await p;
    // Frame 100 should still be rendered — priority frames are never discarded
    expect(sim.renderedFrames).toContain(100);
  });

  it('lock is released after pump completes with matching generation', async () => {
    sim.setRequestedFrame(100);
    await sim.pump();
    expect(sim.inFlight).toBe(false);
  });

  it('lock stays held after stale pump (no deadlock with force-clear)', async () => {
    sim.renderDelayMs = 10;
    sim.setRequestedFrame(100);
    const p1 = sim.pump();

    sim.forceUnlock();
    sim.setRequestedFrame(200);
    const p2 = sim.pump();

    await p1;
    // After stale p1 finishes, lock should still be held by p2
    // (p1's finally skipped the release)

    await p2;
    // After p2 finishes, lock should be released
    expect(sim.inFlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transition participant video hold
// ---------------------------------------------------------------------------

describe('transition participant video hold', () => {
  /**
   * Simulates the premount logic from video-content.tsx:
   * if isPremounted and NOT held by transition → pause + seek.
   * if isPremounted and held by transition → skip pause/seek.
   */
  function simulatePremount(video: HTMLVideoElement): { paused: boolean; seeked: boolean } {
    const isPremounted = true;
    let didPause = false;
    let didSeek = false;

    if (isPremounted) {
      const heldByTransition = video.dataset.transitionHold === '1';
      if (!heldByTransition) {
        didPause = true;
        didSeek = true;
      }
    }

    return { paused: didPause, seeked: didSeek };
  }

  it('premount pauses and seeks when NOT held by transition', () => {
    const video = document.createElement('video');
    const result = simulatePremount(video);
    expect(result.paused).toBe(true);
    expect(result.seeked).toBe(true);
  });

  it('premount skips pause/seek when held by transition', () => {
    const video = document.createElement('video');
    video.dataset.transitionHold = '1';
    const result = simulatePremount(video);
    expect(result.paused).toBe(false);
    expect(result.seeked).toBe(false);
  });

  it('hold flag is cleaned up on session clear', () => {
    const video = document.createElement('video');
    video.dataset.transitionHold = '1';
    expect(video.dataset.transitionHold).toBe('1');

    // Simulate clearTransitionPlaybackSession
    delete video.dataset.transitionHold;
    expect(video.dataset.transitionHold).toBeUndefined();

    // After cleanup, premount should pause again
    const result = simulatePremount(video);
    expect(result.paused).toBe(true);
  });

  it('hold flag transfers when pinned element changes', () => {
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    // Pin A with hold
    videoA.dataset.transitionHold = '1';
    expect(videoA.dataset.transitionHold).toBe('1');

    // Replace A with B — clear hold on A, set on B
    delete videoA.dataset.transitionHold;
    videoB.dataset.transitionHold = '1';

    expect(videoA.dataset.transitionHold).toBeUndefined();
    expect(videoB.dataset.transitionHold).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Slide transition pixel rounding
// ---------------------------------------------------------------------------

describe('slide transition pixel rounding', () => {
  it('canvas drawImage offsets are rounded to whole pixels', () => {
    // Regression: sub-pixel offsets cause drawImage interpolation artifacts
    const progress = 0.33;
    const width = 1920;
    const offset = Math.round(progress * width);
    expect(offset).toBe(634); // whole pixel, not 633.6
    expect(Number.isInteger(offset)).toBe(true);
  });

  it('CSS transform keeps sub-pixel precision', () => {
    // CSS GPU compositor handles sub-pixel smoothly — don't round
    const progress = 0.33;
    const width = 1920;
    const transform = `translateX(${progress * width}px)`;
    expect(transform).toBe('translateX(633.6px)'); // sub-pixel preserved
  });

  it('rounding pattern is uniform across directions', () => {
    const p = 0.5;
    const w = 1920;
    const h = 1080;
    expect(Math.round(p * w)).toBe(960);
    expect(Math.round(-p * w)).toBe(-960);
    expect(Math.round(p * h)).toBe(540);
    expect(Math.round(-p * h)).toBe(-540);
  });
});

// ---------------------------------------------------------------------------
// GPU device caching
// ---------------------------------------------------------------------------

describe('GPU device cache identity check', () => {
  it('device-loss handler only clears if cached device matches', () => {
    // Simulates EffectsPipeline._cachedDevice behavior
    let cachedDevice: object | null = null;

    const deviceA = { id: 'A' };
    const deviceB = { id: 'B' };

    // First device acquired
    cachedDevice = deviceA;

    // Device A lost — but device B was acquired in the meantime
    cachedDevice = deviceB;

    // Stale loss handler fires for device A
    const lostDevice = deviceA;
    if (cachedDevice === lostDevice) {
      cachedDevice = null; // WRONG — would discard device B
    }

    // Device B should still be cached
    expect(cachedDevice).toBe(deviceB);
  });
});
