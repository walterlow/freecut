import { describe, expect, it } from 'vitest';
import {
  getWaveformActiveTileCount,
  getWaveformZoomRedrawIntervalMs,
} from './adaptive-render-version';

describe('adaptive waveform render version helpers', () => {
  it('derives active tile count from the visible window plus overscan', () => {
    expect(getWaveformActiveTileCount({
      renderWidth: 5200,
      visibleStartPx: 900,
      visibleEndPx: 3100,
    })).toBe(5);
  });

  it('clamps active tile count to the total tile count for short clips', () => {
    expect(getWaveformActiveTileCount({
      renderWidth: 700,
      visibleStartPx: 0,
      visibleEndPx: 700,
    })).toBe(1);
  });

  it('uses shorter redraw intervals for fewer visible tiles', () => {
    expect(getWaveformZoomRedrawIntervalMs(2)).toBe(16);
    expect(getWaveformZoomRedrawIntervalMs(4)).toBe(20);
    expect(getWaveformZoomRedrawIntervalMs(8)).toBe(24);
    expect(getWaveformZoomRedrawIntervalMs(12)).toBe(32);
  });
});
