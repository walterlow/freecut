// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  canRetainSnapshotForTransformChanges,
  createTransformStableItemsSelector,
} from './use-transform-stable-items-snapshot'

function createShape(
  overrides: Partial<Extract<TimelineItem, { type: 'shape' }>> = {},
): Extract<TimelineItem, { type: 'shape' }> {
  return {
    id: 'shape-1',
    trackId: 'track-1',
    type: 'shape',
    shapeType: 'polygon',
    fillColor: '#4488ff',
    label: 'Polygon',
    from: 0,
    durationInFrames: 100,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  }
}

function toState(items: TimelineItem[]) {
  return {
    items,
    itemsByTrackId: { 'track-1': items },
  }
}

describe('transform-stable preview items snapshot', () => {
  it('retains one scene snapshot across repeated ordinary transform commits', () => {
    const select = createTransformStableItemsSelector()
    const initial = createShape()
    const firstSnapshot = select(toState([initial]))

    const moved = { ...initial, transform: { ...initial.transform, x: 240 } }
    const movedSnapshot = select(toState([moved]))
    const movedAgain = { ...moved, transform: { ...moved.transform, y: -80 } }
    const movedAgainSnapshot = select(toState([movedAgain]))

    expect(movedSnapshot).toBe(firstSnapshot)
    expect(movedAgainSnapshot).toBe(firstSnapshot)
    expect(firstSnapshot.items[0]).toBe(initial)
  })

  it('refreshes to the latest complete item on the next non-transform edit', () => {
    const select = createTransformStableItemsSelector()
    const initial = createShape()
    const firstSnapshot = select(toState([initial]))
    const moved = { ...initial, transform: { ...initial.transform, x: 240 } }

    expect(select(toState([moved]))).toBe(firstSnapshot)

    const recolored = { ...moved, fillColor: '#ff5500' }
    const recoloredSnapshot = select(toState([recolored]))

    expect(recoloredSnapshot).not.toBe(firstSnapshot)
    expect(recoloredSnapshot.items[0]).toBe(recolored)
    expect(recoloredSnapshot.items[0]?.transform?.x).toBe(240)
  })

  it('does not retain topology, timing, or mask-transform changes', () => {
    const initial = createShape()

    expect(
      canRetainSnapshotForTransformChanges(
        [initial],
        [{ ...initial, from: 12, transform: { ...initial.transform, x: 10 } }],
      ),
    ).toBe(false)
    expect(
      canRetainSnapshotForTransformChanges(
        [initial],
        [{ ...initial, trackId: 'track-2', transform: { ...initial.transform, x: 10 } }],
      ),
    ).toBe(false)
    expect(
      canRetainSnapshotForTransformChanges(
        [{ ...initial, isMask: true }],
        [{ ...initial, isMask: true, transform: { ...initial.transform, x: 10 } }],
      ),
    ).toBe(false)
    expect(canRetainSnapshotForTransformChanges([initial], [])).toBe(false)
  })
})
