import { describe, expect, it } from 'vitest'

import { buildSegmentSpans } from './dopesheet-timeline-cells'

describe('buildSegmentSpans', () => {
  it('pairs consecutive points in frame order regardless of input order', () => {
    const spans = buildSegmentSpans([
      { from: 'b', frame: 10, x: 100 },
      { from: 'a', frame: 0, x: 20 },
      { from: 'c', frame: 20, x: 260 },
    ])
    // Sorted by frame → segments a→b then b→c, each carrying the "from" datum.
    expect(spans.map((s) => s.from)).toEqual(['a', 'b'])
    expect(spans[0]).toMatchObject({ from: 'a', left: 20, width: 80 })
    expect(spans[1]).toMatchObject({ from: 'b', left: 100, width: 160 })
  })

  it('uses the smaller x as the left edge even when x decreases', () => {
    const spans = buildSegmentSpans([
      { from: 'a', frame: 0, x: 200 },
      { from: 'b', frame: 10, x: 50 },
    ])
    expect(spans[0]).toMatchObject({ from: 'a', left: 50, width: 150 })
  })

  it('drops zero-width spans and returns nothing for a single point', () => {
    expect(buildSegmentSpans([{ from: 'only', frame: 5, x: 40 }])).toEqual([])
    expect(
      buildSegmentSpans([
        { from: 'a', frame: 0, x: 40 },
        { from: 'b', frame: 10, x: 40 },
      ]),
    ).toEqual([])
  })
})
