import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from './Clock';

describe('Clock hidden tab playback', () => {
  let nowMs = 0;
  let nextRafId = 1;
  let rafCallbacks = new Map<number, FrameRequestCallback>();

  const runNextAnimationFrame = (nextNowMs: number) => {
    const [id, callback] = rafCallbacks.entries().next().value as [number, FrameRequestCallback];
    rafCallbacks.delete(id);
    nowMs = nextNowMs;
    callback(nextNowMs);
  };

  beforeEach(() => {
    nowMs = 0;
    nextRafId = 1;
    rafCallbacks = new Map<number, FrameRequestCallback>();

    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      rafCallbacks.delete(id);
    }) as typeof cancelAnimationFrame);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as Document & { hidden?: boolean }).hidden;
  });

  it('keeps advancing with elapsed time while the tab is hidden', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    });

    clock.play();
    expect(rafCallbacks.size).toBe(1);

    runNextAnimationFrame(1000);
    expect(clock.currentFrame).toBe(30);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });

    runNextAnimationFrame(2000);
    expect(clock.currentFrame).toBe(60);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });

    runNextAnimationFrame(2500);
    expect(clock.currentFrame).toBe(75);

    clock.dispose();
  });

  it('catches up immediately when window focus returns before the next RAF', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    });

    clock.play();
    expect(rafCallbacks.size).toBe(1);

    runNextAnimationFrame(1000);
    expect(clock.currentFrame).toBe(30);

    nowMs = 2500;
    window.dispatchEvent(new Event('focus'));
    expect(clock.currentFrame).toBe(75);

    clock.dispose();
  });
});
