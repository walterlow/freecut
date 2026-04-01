import { describe, expect, it } from 'vitest';
import {
  formatFpsValue,
  getProjectFpsOptions,
  resolveAutoMatchProjectFps,
} from './project-fps';

describe('project-fps helpers', () => {
  it('keeps legacy fps visible when editing an older project', () => {
    const options = getProjectFpsOptions(120);

    expect(options.map((option) => option.value)).toEqual([24, 25, 30, 50, 60, 120]);
    expect(options.at(-1)?.label).toContain('Legacy');
  });

  it('maps common source rates to the closest supported project fps', () => {
    expect(resolveAutoMatchProjectFps(29.97)).toEqual({ fps: 30, exact: false });
    expect(resolveAutoMatchProjectFps(59.94)).toEqual({ fps: 60, exact: false });
    expect(resolveAutoMatchProjectFps(120)).toEqual({ fps: 60, exact: false });
    expect(resolveAutoMatchProjectFps(240)).toEqual({ fps: 60, exact: false });
  });

  it('formats integer and decimal fps values cleanly', () => {
    expect(formatFpsValue(60)).toBe('60');
    expect(formatFpsValue(59.94)).toBe('59.94');
    expect(formatFpsValue(23.976)).toBe('23.976');
  });
});
