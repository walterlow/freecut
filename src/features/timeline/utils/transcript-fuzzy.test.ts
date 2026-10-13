// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  boundedLevenshtein,
  findTranscriptWordMatches,
  fuzzyThreshold,
  normalizeForSearch,
} from './transcript-fuzzy'

describe('normalizeForSearch', () => {
  it('folds case and diacritics', () => {
    expect(normalizeForSearch('CAFÉ')).toBe('cafe')
    expect(normalizeForSearch('Tüm')).toBe('tum')
  })
})

describe('boundedLevenshtein', () => {
  it('computes distance for near words', () => {
    expect(boundedLevenshtein('vid', 'ved', 2)).toBe(1)
    expect(boundedLevenshtein('silence', 'silences', 2)).toBe(1)
    expect(boundedLevenshtein('kitten', 'sitting', 3)).toBe(3)
  })

  it('returns 0 for identical strings', () => {
    expect(boundedLevenshtein('netherlands', 'netherlands', 2)).toBe(0)
  })

  it('early-exits beyond the ceiling', () => {
    // Distance is 7, ceiling is 2 → returns max + 1, never the true distance.
    expect(boundedLevenshtein('cat', 'elephant', 2)).toBe(3)
  })

  it('handles empty strings', () => {
    expect(boundedLevenshtein('', 'abc', 5)).toBe(3)
    expect(boundedLevenshtein('abc', '', 5)).toBe(3)
  })
})

describe('fuzzyThreshold', () => {
  it('scales with query length', () => {
    expect(fuzzyThreshold(3)).toBe(1)
    expect(fuzzyThreshold(6)).toBe(2)
    expect(fuzzyThreshold(12)).toBe(3)
  })
})

describe('findTranscriptWordMatches', () => {
  const words = ['How', 'to', 'trim', 'silences', 'in', 'Ved', 'editor']

  it('returns empty for a blank query', () => {
    expect(findTranscriptWordMatches(words, '   ')).toEqual({ spans: [], approximate: false })
  })

  it('matches exact substrings without approximation', () => {
    const result = findTranscriptWordMatches(words, 'sil')
    expect(result).toEqual({ spans: [{ start: 3, end: 3 }], approximate: false })
  })

  it('is case- and punctuation-insensitive on exact matches', () => {
    const result = findTranscriptWordMatches(['Trim,', 'TRIMMED'], 'trim')
    expect(result.approximate).toBe(false)
    expect(result.spans).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
    ])
  })

  it('falls back to fuzzy only when exact finds nothing', () => {
    // "Vid" is not a substring of any token, but is one edit from "Ved".
    const result = findTranscriptWordMatches(words, 'Vid')
    expect(result.approximate).toBe(true)
    expect(result.spans).toEqual([{ start: 5, end: 5 }])
  })

  it('does not fuzz when an exact match exists', () => {
    const result = findTranscriptWordMatches(words, 'trim')
    expect(result).toEqual({ spans: [{ start: 2, end: 2 }], approximate: false })
  })

  it('skips fuzzy for very short queries', () => {
    const result = findTranscriptWordMatches(['ax', 'by'], 'az')
    expect(result).toEqual({ spans: [], approximate: false })
  })
})

describe('findTranscriptWordMatches — phrases', () => {
  const words = ['So', 'I', 'gonna', 'remove', 'silences', 'in', 'this', 'video']

  it('matches a phrase across consecutive tokens', () => {
    const result = findTranscriptWordMatches(words, 'remove silences')
    expect(result).toEqual({ spans: [{ start: 3, end: 4 }], approximate: false })
  })

  it('allows the trailing word to be a prefix while typing', () => {
    const result = findTranscriptWordMatches(words, 'remove sil')
    expect(result.spans).toEqual([{ start: 3, end: 4 }])
  })

  it('requires whole words for all but the last token', () => {
    // "sil" as a non-final word must not match "silences".
    expect(findTranscriptWordMatches(words, 'sil in').spans).toEqual([])
  })

  it('does not match a phrase that is not contiguous', () => {
    expect(findTranscriptWordMatches(words, 'remove video').spans).toEqual([])
  })

  it('is punctuation-insensitive across the phrase', () => {
    const punctuated = ['remove', 'silences,', 'in']
    expect(findTranscriptWordMatches(punctuated, 'silences in').spans).toEqual([
      { start: 1, end: 2 },
    ])
  })
})
