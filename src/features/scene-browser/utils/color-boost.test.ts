import { describe, expect, it } from 'vitest';
import { colorBoostFor, extractQueryColors, parseColorQuery } from './color-boost';
import type { PaletteEntry } from '../deps/analysis';

describe('extractQueryColors', () => {
  it('finds a single family for an explicit color-intent query', () => {
    const result = extractQueryColors('red color');
    expect(result.map((r) => r.family)).toEqual(['red']);
  });

  it('maps synonyms to their canonical family when the query is palette-oriented', () => {
    const result = extractQueryColors('crimson tones');
    expect(result.map((r) => r.family)).toEqual(['red']);
  });

  it('returns empty for queries with no color terms', () => {
    expect(extractQueryColors('a man fighting')).toEqual([]);
  });

  it('returns empty for bare color words without explicit palette intent', () => {
    expect(extractQueryColors('ruby scarlet red')).toEqual([]);
    expect(extractQueryColors('orange sunset over navy water')).toEqual([]);
  });

  it('supports color prefix syntax and multiple distinct families', () => {
    const result = extractQueryColors('color orange palette navy');
    expect(result.map((r) => r.family).sort()).toEqual(['blue', 'orange']);
  });
});

describe('parseColorQuery', () => {
  it('marks pure color-intent queries as palette-only', () => {
    expect(parseColorQuery('yellow color')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: true,
    });
    expect(parseColorQuery('color:yellow')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: true,
    });
  });

  it('keeps mixed content queries out of palette-only mode', () => {
    expect(parseColorQuery('yellow color jacket')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: false,
    });
  });
});

const REDS: PaletteEntry = { l: 53, a: 70, b: 50, weight: 0.5 };
const GREEN: PaletteEntry = { l: 60, a: -55, b: 50, weight: 0.3 };
const BLUES: PaletteEntry = { l: 40, a: 15, b: -60, weight: 0.2 };

describe('colorBoostFor', () => {
  it('returns a non-zero boost when palette contains the query color', () => {
    const queries = extractQueryColors('red color');
    const result = colorBoostFor(queries, [REDS, GREEN, BLUES]);
    expect(result).not.toBeNull();
    expect(result?.family).toBe('red');
    expect(result?.boost).toBeGreaterThan(0.1);
  });

  it('returns null when palette has no close match', () => {
    const queries = extractQueryColors('red color');
    const result = colorBoostFor(queries, [
      { l: 60, a: -55, b: 50, weight: 1.0 },
    ]);
    expect(result).toBeNull();
  });

  it('returns null for empty palette', () => {
    const queries = extractQueryColors('red color');
    expect(colorBoostFor(queries, [])).toBeNull();
    expect(colorBoostFor(queries, undefined)).toBeNull();
  });

  it('returns null for query without color words', () => {
    const queries = extractQueryColors('a scene with people');
    expect(colorBoostFor(queries, [REDS, GREEN, BLUES])).toBeNull();
  });

  it('weighs larger palette entries higher', () => {
    const queries = extractQueryColors('red color');
    const majorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.8 }]);
    const minorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.05 }]);
    expect(majorRed?.boost).toBeGreaterThan(minorRed?.boost ?? 0);
  });

  it('picks the best match across multiple query colors', () => {
    const queries = extractQueryColors('red and blue palette');
    const result = colorBoostFor(queries, [
      { l: 50, a: 50, b: 40, weight: 0.2 },
      { l: 42, a: 18, b: -58, weight: 0.7 },
    ]);
    expect(result?.family).toBe('blue');
  });
});
