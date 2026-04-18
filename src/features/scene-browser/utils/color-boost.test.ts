import { describe, expect, it } from 'vitest';
import { colorBoostFor, extractQueryColors } from './color-boost';
import type { PaletteEntry } from '../deps/analysis';

describe('extractQueryColors', () => {
  it('finds a single family for a bare color query', () => {
    const result = extractQueryColors('red color');
    expect(result.map((r) => r.family)).toEqual(['red']);
  });

  it('maps synonyms to their canonical family', () => {
    const result = extractQueryColors('crimson tones');
    expect(result.map((r) => r.family)).toEqual(['red']);
  });

  it('returns empty for queries with no color terms', () => {
    expect(extractQueryColors('a man fighting')).toEqual([]);
  });

  it('deduplicates same family across synonyms', () => {
    const result = extractQueryColors('ruby scarlet red');
    expect(result.map((r) => r.family)).toEqual(['red']);
  });

  it('keeps multiple distinct families', () => {
    const result = extractQueryColors('orange sunset over navy water');
    expect(result.map((r) => r.family).sort()).toEqual(['blue', 'orange']);
  });
});

const REDS: PaletteEntry = { l: 53, a: 70, b: 50, weight: 0.5 };
const GREEN: PaletteEntry = { l: 60, a: -55, b: 50, weight: 0.3 };
const BLUES: PaletteEntry = { l: 40, a: 15, b: -60, weight: 0.2 };

describe('colorBoostFor', () => {
  it('returns a non-zero boost when palette contains the query color', () => {
    const queries = extractQueryColors('red');
    const result = colorBoostFor(queries, [REDS, GREEN, BLUES]);
    expect(result).not.toBeNull();
    expect(result?.family).toBe('red');
    expect(result?.boost).toBeGreaterThan(0.1);
  });

  it('returns null when palette has no close match', () => {
    const queries = extractQueryColors('red');
    const result = colorBoostFor(queries, [
      { l: 60, a: -55, b: 50, weight: 1.0 }, // pure green
    ]);
    expect(result).toBeNull();
  });

  it('returns null for empty palette', () => {
    const queries = extractQueryColors('red');
    expect(colorBoostFor(queries, [])).toBeNull();
    expect(colorBoostFor(queries, undefined)).toBeNull();
  });

  it('returns null for query without color words', () => {
    const queries = extractQueryColors('a scene with people');
    expect(colorBoostFor(queries, [REDS, GREEN, BLUES])).toBeNull();
  });

  it('weighs larger palette entries higher', () => {
    const queries = extractQueryColors('red');
    const majorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.8 }]);
    const minorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.05 }]);
    expect(majorRed?.boost).toBeGreaterThan(minorRed?.boost ?? 0);
  });

  it('picks the best match across multiple query colors', () => {
    const queries = extractQueryColors('red or blue');
    // Palette has a closer blue than red — should pick blue.
    const result = colorBoostFor(queries, [
      { l: 50, a: 50, b: 40, weight: 0.2 }, // slightly off red
      { l: 42, a: 18, b: -58, weight: 0.7 }, // near-perfect blue, dominant
    ]);
    expect(result?.family).toBe('blue');
  });
});
