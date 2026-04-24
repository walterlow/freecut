import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSnapshot,
  secondsToFrames,
  validateSnapshot,
} from '@freecut/core';
import { collectProjectMediaUsage } from '@freecut/core/media-plan';
import { validateRangeFrames } from '@freecut/core/range';
import { resolveProjectRenderRange } from '@freecut/core/render-plan';
import { SNAPSHOT_VERSION } from '@freecut/core/snapshot';
import { buildRange as buildRangeFromSubpath } from '@freecut/core/workspace';

describe('package exports', () => {
  it('imports the public package surface by package name', () => {
    expect(typeof parseSnapshot).toBe('function');
    expect(typeof validateSnapshot).toBe('function');
    expect(secondsToFrames(1, 30)).toBe(30);
  });

  it('imports public subpath modules', () => {
    expect(SNAPSHOT_VERSION).toBe('1.0');
    expect(buildRangeFromSubpath({ start: '0', duration: '1' })).toEqual({
      startSeconds: 0,
      durationSeconds: 1,
    });
  });

  it('imports browser-safe public subpaths', () => {
    expect(validateRangeFrames(0, 1)).toEqual({ inFrame: 0, outFrame: 1 });
    expect(collectProjectMediaUsage({ timeline: { items: [] } })).toBeInstanceOf(Map);
    expect(resolveProjectRenderRange({
      metadata: { fps: 30 },
      timeline: { inPoint: 0, outPoint: 30 },
    })).toEqual({ inFrame: 0, outFrame: 30 });
  });

  it('keeps the root browser-safe by excluding workspace imports', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const rootIndex = await readFile(join(here, '..', 'dist', 'index.js'), 'utf8');

    expect(rootIndex).not.toContain('./workspace');
    expect(rootIndex).not.toContain('node:fs/promises');
  });
});
