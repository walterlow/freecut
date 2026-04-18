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

  it('extracts color families for bare color-only queries', () => {
    // A query that is *only* color words has no object semantics — the
    // ranker should match against the palette instead of sending CLIP
    // chasing unrelated captions that happen to cluster near the token.
    expect(extractQueryColors('ruby scarlet red').map((c) => c.family)).toEqual(['red']);
    expect(extractQueryColors('pink').map((c) => c.family)).toEqual(['pink']);
  });

  it('returns empty when non-color content words are present without explicit palette intent', () => {
    expect(extractQueryColors('orange sunset navy water')).toEqual([]);
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

  it('treats bare single-color queries as palette intent', () => {
    expect(parseColorQuery('pink')).toMatchObject({
      colors: [{ family: 'pink' }],
      paletteOnly: true,
    });
  });

  it('treats multi-color-only queries as palette intent', () => {
    expect(parseColorQuery('pink purple')).toMatchObject({
      colors: [{ family: 'pink' }, { family: 'purple' }],
      paletteOnly: true,
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

  it('does not match pink against warm skin-tone palette entries', () => {
    // Lab ~(65, 20, 20) is a common medium skin tone — warm, moderate
    // chroma. It sat within the old pink boost range and polluted "pink"
    // results with face-dominated dim scenes.
    const queries = extractQueryColors('pink');
    const result = colorBoostFor(queries, [
      { l: 65, a: 20, b: 20, weight: 0.5 },
      { l: 40, a: 10, b: 15, weight: 0.3 },
    ]);
    expect(result).toBeNull();
  });

  it('matches pink against genuinely pink palette entries', () => {
    const queries = extractQueryColors('pink');
    const result = colorBoostFor(queries, [
      { l: 65, a: 55, b: -5, weight: 0.4 },
      { l: 20, a: 5, b: 5, weight: 0.4 },
    ]);
    expect(result).not.toBeNull();
    expect(result?.family).toBe('pink');
    expect(result?.boost).toBeGreaterThan(0.1);
  });

  it('does not match chromatic families against low-chroma gray palette entries', () => {
    const queries = extractQueryColors('red');
    const result = colorBoostFor(queries, [
      { l: 55, a: 2, b: 1, weight: 0.8 }, // near-gray
    ]);
    expect(result).toBeNull();
  });

  it('still matches neutral families against low-chroma entries', () => {
    // The chroma/hue gate applies only to chromatic families — gray,
    // black, white should still match near-neutral palette entries.
    const queries = extractQueryColors('gray tones');
    const result = colorBoostFor(queries, [
      { l: 55, a: 2, b: 1, weight: 0.6 },
    ]);
    expect(result).not.toBeNull();
    expect(result?.family).toBe('gray');
  });
});
