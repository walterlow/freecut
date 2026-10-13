// @vitest-environment node

import { describe, it, expect } from 'vite-plus/test'
import type { ProjectMarker } from '@/types/timeline'
import { getMarkerOrdinals, resolveMarkerNames } from './marker-names'

const marker = (id: string, frame: number, label?: string): ProjectMarker => ({
  id,
  frame,
  color: '#3B82F6',
  ...(label === undefined ? {} : { label }),
})

const named = (markers: ProjectMarker[]) => resolveMarkerNames(markers, (n) => `Marker ${n}`)

describe('getMarkerOrdinals', () => {
  it('numbers markers by frame, not by creation order', () => {
    const ordinals = getMarkerOrdinals([marker('c', 300), marker('a', 100), marker('b', 200)])

    expect(ordinals.get('a')).toBe(1)
    expect(ordinals.get('b')).toBe(2)
    expect(ordinals.get('c')).toBe(3)
  })

  it('breaks ties on the same frame by id so numbering is stable', () => {
    const forward = getMarkerOrdinals([marker('a', 50), marker('b', 50)])
    const reversed = getMarkerOrdinals([marker('b', 50), marker('a', 50)])

    expect(forward).toEqual(reversed)
  })
})

describe('resolveMarkerNames', () => {
  it('prefers the label over the ordinal fallback', () => {
    expect(named([marker('a', 0, 'intro cut')]).get('a')).toBe('intro cut')
  })

  it('falls back to the ordinal for empty and whitespace-only labels', () => {
    const names = named([marker('a', 0), marker('b', 10, ''), marker('c', 20, '   ')])

    expect(names.get('a')).toBe('Marker 1')
    expect(names.get('b')).toBe('Marker 2')
    expect(names.get('c')).toBe('Marker 3')
  })

  it('renumbers unnamed markers when one is inserted earlier', () => {
    const existing = [marker('a', 100), marker('b', 200)]
    expect(named(existing).get('b')).toBe('Marker 2')

    const withInsert = [...existing, marker('inserted', 50)]
    expect(named(withInsert).get('inserted')).toBe('Marker 1')
    expect(named(withInsert).get('a')).toBe('Marker 2')
    expect(named(withInsert).get('b')).toBe('Marker 3')
  })

  it('numbers around labelled markers rather than skipping them', () => {
    const names = named([marker('a', 100), marker('b', 200, 'chorus'), marker('c', 300)])

    expect(names.get('a')).toBe('Marker 1')
    expect(names.get('b')).toBe('chorus')
    expect(names.get('c')).toBe('Marker 3')
  })

  it('does not mutate the input array', () => {
    const markers = [marker('c', 300), marker('a', 100)]
    named(markers)

    expect(markers.map((m) => m.id)).toEqual(['c', 'a'])
  })
})
