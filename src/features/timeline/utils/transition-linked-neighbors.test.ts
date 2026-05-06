import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import {
  findEditNeighborsWithTransitions,
  findHandleNeighborWithTransitions,
  findNearestNeighbors,
} from './transition-linked-neighbors'

function makeVideo(id: string, from: number, durationInFrames: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
  }
}

function makeTransition(leftClipId: string, rightClipId: string): Transition {
  return {
    id: `${leftClipId}-${rightClipId}`,
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames: 20,
  }
}

describe('transition-linked-neighbors', () => {
  it('uses adjacent neighbors when clips are butt-joined', () => {
    const left = makeVideo('left', 0, 100)
    const mid = makeVideo('mid', 100, 100)
    const right = makeVideo('right', 200, 100)
    const items: TimelineItem[] = [left, mid, right]

    const result = findEditNeighborsWithTransitions(mid, items, [])
    expect(result.leftNeighbor?.id).toBe('left')
    expect(result.rightNeighbor?.id).toBe('right')
  })

  it('falls back to transition-linked neighbors when overlap breaks strict adjacency', () => {
    const left = makeVideo('left', 0, 100)
    const mid = makeVideo('mid', 80, 100)
    const right = makeVideo('right', 160, 100)
    const items: TimelineItem[] = [left, mid, right]
    const transitions = [makeTransition('left', 'mid'), makeTransition('mid', 'right')]

    const result = findEditNeighborsWithTransitions(mid, items, transitions)
    expect(result.leftNeighbor?.id).toBe('left')
    expect(result.rightNeighbor?.id).toBe('right')
  })

  it('resolves handle-specific neighbor using transition links', () => {
    const left = makeVideo('left', 0, 100)
    const mid = makeVideo('mid', 80, 100)
    const items: TimelineItem[] = [left, mid]
    const transitions = [makeTransition('left', 'mid')]

    const startNeighbor = findHandleNeighborWithTransitions(mid, 'start', items, transitions)
    const endNeighbor = findHandleNeighborWithTransitions(mid, 'end', items, transitions)

    expect(startNeighbor?.id).toBe('left')
    expect(endNeighbor).toBeNull()
  })
})

describe('findNearestNeighbors', () => {
  it('finds the nearest clip on each side regardless of adjacency', () => {
    const a = makeVideo('a', 0, 50)
    const mid = makeVideo('mid', 100, 50)
    const b = makeVideo('b', 200, 50)

    const result = findNearestNeighbors(mid, [a, mid, b])
    expect(result.leftNeighbor?.id).toBe('a')
    expect(result.rightNeighbor?.id).toBe('b')
  })

  it('picks the closest left neighbor when multiple exist', () => {
    const far = makeVideo('far', 0, 30)
    const close = makeVideo('close', 40, 30)
    const mid = makeVideo('mid', 100, 50)

    const result = findNearestNeighbors(mid, [far, close, mid])
    expect(result.leftNeighbor?.id).toBe('close')
  })

  it('picks the closest right neighbor when multiple exist', () => {
    const mid = makeVideo('mid', 0, 50)
    const close = makeVideo('close', 60, 30)
    const far = makeVideo('far', 200, 30)

    const result = findNearestNeighbors(mid, [mid, close, far])
    expect(result.rightNeighbor?.id).toBe('close')
  })

  it('ignores items on different tracks', () => {
    const mid = makeVideo('mid', 100, 50)
    const otherTrack: VideoItem = { ...makeVideo('other', 200, 50), trackId: 'track-2' }

    const result = findNearestNeighbors(mid, [mid, otherTrack])
    expect(result.rightNeighbor).toBeNull()
  })

  it('returns null neighbors when no clips exist on same track', () => {
    const solo = makeVideo('solo', 100, 50)
    const result = findNearestNeighbors(solo, [solo])
    expect(result.leftNeighbor).toBeNull()
    expect(result.rightNeighbor).toBeNull()
  })
})
