import { describe, expect, it } from 'vitest';
import { deterministicIds, randomIds } from '../src/index.mjs';

describe('id helpers', () => {
  it('generates deterministic ids per kind', () => {
    const ids = deterministicIds();
    expect(ids('project')).toBe('project-1');
    expect(ids('track')).toBe('track-1');
    expect(ids('project')).toBe('project-2');
  });

  it('supports seeded deterministic ids and random id prefixes', () => {
    const seeded = deterministicIds(10);
    expect(seeded('item')).toBe('item-11');
    expect(randomIds('media')).toMatch(/^media-[a-f0-9]{16}$/);
  });
});
