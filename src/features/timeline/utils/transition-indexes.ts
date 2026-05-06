/**
 * Transition Index Builders
 *
 * Functions to build optimized lookup structures for transitions.
 * These indexes enable O(1) lookups instead of O(n) array scans.
 *
 * Indexes are rebuilt when transitions change and cached in the chain store.
 */

import type { Transition, ClipTransitionIndex } from '@/types/transition'

/**
 * Result of building all transition indexes
 */
export interface TransitionIndexes {
  /** O(1) lookup: clipId -> { incoming?, outgoing? } */
  transitionsByClipId: Map<string, ClipTransitionIndex>
  /** O(1) lookup: trackId -> transitions on that track */
  transitionsByTrackId: Map<string, Transition[]>
  /** O(1) lookup: transitionId -> transition */
  transitionsById: Map<string, Transition>
}

/**
 * Build all transition indexes from the transitions array.
 * Called once when transitions change, provides O(1) lookups.
 */
export function buildTransitionIndexes(transitions: Transition[]): TransitionIndexes {
  const transitionsByClipId = new Map<string, ClipTransitionIndex>()
  const transitionsByTrackId = new Map<string, Transition[]>()
  const transitionsById = new Map<string, Transition>()

  for (const t of transitions) {
    // By ID
    transitionsById.set(t.id, t)

    // By track
    if (!transitionsByTrackId.has(t.trackId)) {
      transitionsByTrackId.set(t.trackId, [])
    }
    transitionsByTrackId.get(t.trackId)!.push(t)

    // By left clip (outgoing transition)
    if (!transitionsByClipId.has(t.leftClipId)) {
      transitionsByClipId.set(t.leftClipId, {})
    }
    transitionsByClipId.get(t.leftClipId)!.outgoing = t

    // By right clip (incoming transition)
    if (!transitionsByClipId.has(t.rightClipId)) {
      transitionsByClipId.set(t.rightClipId, {})
    }
    transitionsByClipId.get(t.rightClipId)!.incoming = t
  }

  return { transitionsByClipId, transitionsByTrackId, transitionsById }
}
