import { describe, expect, it } from 'vitest';
import { getPreloadWindowRange } from './preload-window';

describe('getPreloadWindowRange', () => {
  it('uses forward window for paused mode', () => {
    expect(
      getPreloadWindowRange({
        mode: 'paused',
        anchorFrame: 100,
        scrubDirection: 0,
        fps: 30,
        aheadSeconds: 5,
      })
    ).toEqual({ startFrame: 100, endFrame: 250 });
  });

  it('uses forward window when scrubbing forward', () => {
    expect(
      getPreloadWindowRange({
        mode: 'scrubbing',
        anchorFrame: 100,
        scrubDirection: 1,
        fps: 30,
        aheadSeconds: 5,
      })
    ).toEqual({ startFrame: 100, endFrame: 250 });
  });

  it('uses backward window when scrubbing backward', () => {
    expect(
      getPreloadWindowRange({
        mode: 'scrubbing',
        anchorFrame: 100,
        scrubDirection: -1,
        fps: 30,
        aheadSeconds: 5,
      })
    ).toEqual({ startFrame: -50, endFrame: 100 });
  });

  it('uses centered window when scrub direction is neutral', () => {
    expect(
      getPreloadWindowRange({
        mode: 'scrubbing',
        anchorFrame: 100,
        scrubDirection: 0,
        fps: 30,
        aheadSeconds: 5,
      })
    ).toEqual({ startFrame: 25, endFrame: 175 });
  });

  it('keeps range width stable when centered', () => {
    const range = getPreloadWindowRange({
      mode: 'scrubbing',
      anchorFrame: 0,
      scrubDirection: 0,
      fps: 24,
      aheadSeconds: 5,
    });

    expect(range.endFrame - range.startFrame).toBe(120);
  });
});
