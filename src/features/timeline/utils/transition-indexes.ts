/**
 * Transition Index Builders
 *
 * Functions to build optimized lookup structures for transitions.
 * These indexes enable O(1) lookups instead of O(n) array scans.
 *
 * Indexes are rebuilt when transitions change and cached in the chain store.
 */

import type { TimelineItem } from '@/types/timeline';
import type {
  Transition,
  ClipTransitionIndex,
  TransitionChain,
} from '@/types/transition';

/**
 * Result of building all transition indexes
 */
export interface TransitionIndexes {
  /** O(1) lookup: clipId -> { incoming?, outgoing? } */
  transitionsByClipId: Map<string, ClipTransitionIndex>;
  /** O(1) lookup: trackId -> transitions on that track */
  transitionsByTrackId: Map<string, Transition[]>;
  /** O(1) lookup: transitionId -> transition */
  transitionsById: Map<string, Transition>;
}

/**
 * Build all transition indexes from the transitions array.
 * Called once when transitions change, provides O(1) lookups.
 */
export function buildTransitionIndexes(
  transitions: Transition[]
): TransitionIndexes {
  const transitionsByClipId = new Map<string, ClipTransitionIndex>();
  const transitionsByTrackId = new Map<string, Transition[]>();
  const transitionsById = new Map<string, Transition>();

  for (const t of transitions) {
    // By ID
    transitionsById.set(t.id, t);

    // By track
    if (!transitionsByTrackId.has(t.trackId)) {
      transitionsByTrackId.set(t.trackId, []);
    }
    transitionsByTrackId.get(t.trackId)!.push(t);

    // By left clip (outgoing transition)
    if (!transitionsByClipId.has(t.leftClipId)) {
      transitionsByClipId.set(t.leftClipId, {});
    }
    transitionsByClipId.get(t.leftClipId)!.outgoing = t;

    // By right clip (incoming transition)
    if (!transitionsByClipId.has(t.rightClipId)) {
      transitionsByClipId.set(t.rightClipId, {});
    }
    transitionsByClipId.get(t.rightClipId)!.incoming = t;
  }

  return { transitionsByClipId, transitionsByTrackId, transitionsById };
}

/**
 * Result of building transition chains
 */
export interface TransitionChainResult {
  /** Chains by track for efficient rendering */
  chainsByTrackId: Map<string, TransitionChain[]>;
  /** All chains flattened */
  allChains: TransitionChain[];
  /** Clips not in any chain (standalone) */
  standaloneClipIds: Set<string>;
  /** O(1) lookup: clipId -> chain it belongs to */
  chainByClipId: Map<string, TransitionChain>;
}

/**
 * Build chains from items and transitions.
 * A chain is a sequence of clips connected by transitions on the same track.
 *
 * This replaces the per-render groupClipsIntoChains() call in MainComposition.
 * Called when transitions OR relevant items change, not on every frame.
 *
 * @param items - Timeline items (filters to video/image only)
 * @param transitions - All transitions
 * @param transitionsByClipId - Pre-built index for O(1) lookups
 * @param previousChains - Previous chains for version comparison (optional)
 */
export function buildTransitionChains(
  items: TimelineItem[],
  transitions: Transition[],
  transitionsByClipId: Map<string, ClipTransitionIndex>,
  previousChains?: TransitionChain[]
): TransitionChainResult {
  const chainsByTrackId = new Map<string, TransitionChain[]>();
  const allChains: TransitionChain[] = [];
  const standaloneClipIds = new Set<string>();
  const chainByClipId = new Map<string, TransitionChain>();
  const visitedClipIds = new Set<string>();

  // Build previous chain lookup for version comparison
  const prevChainById = new Map<string, TransitionChain>();
  if (previousChains) {
    for (const chain of previousChains) {
      prevChainById.set(chain.id, chain);
    }
  }

  // Filter to only visual items that can have transitions
  const visualItems = items.filter(
    (i) => i.type === 'video' || i.type === 'image'
  );

  // Build item lookup for O(1) access
  const itemsById = new Map<string, TimelineItem>();
  for (const item of visualItems) {
    itemsById.set(item.id, item);
  }

  // Sort by track and position for consistent processing
  const sortedItems = [...visualItems].sort((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    return a.from - b.from;
  });

  for (const item of sortedItems) {
    if (visitedClipIds.has(item.id)) continue;

    const clipIndex = transitionsByClipId.get(item.id);

    // No transitions = standalone clip
    if (!clipIndex?.incoming && !clipIndex?.outgoing) {
      standaloneClipIds.add(item.id);
      visitedClipIds.add(item.id);
      continue;
    }

    // Walk left to find chain start
    let chainStart = item;
    while (true) {
      const incoming = transitionsByClipId.get(chainStart.id)?.incoming;
      if (!incoming) break;
      const leftClip = itemsById.get(incoming.leftClipId);
      if (!leftClip || visitedClipIds.has(leftClip.id)) break;
      chainStart = leftClip;
    }

    // Walk right to build chain
    const clipIds: string[] = [];
    const transitionIds: string[] = [];
    let current: TimelineItem | undefined = chainStart;
    let totalDuration = 0;
    let totalOverlap = 0;

    while (current && !visitedClipIds.has(current.id)) {
      clipIds.push(current.id);
      visitedClipIds.add(current.id);
      totalDuration += current.durationInFrames;

      const outgoing = transitionsByClipId.get(current.id)?.outgoing;
      if (!outgoing) break;

      transitionIds.push(outgoing.id);
      totalOverlap += outgoing.durationInFrames;

      const nextClip = itemsById.get(outgoing.rightClipId);
      if (!nextClip || visitedClipIds.has(nextClip.id)) break;
      current = nextClip;
    }

    // Only create chain if more than one clip (single clips with broken refs are standalone)
    if (clipIds.length > 1) {
      const firstClip = itemsById.get(clipIds[0]!)!;
      const lastClip = itemsById.get(clipIds[clipIds.length - 1]!)!;

      // Generate stable chain ID based on first clip
      const chainId = `chain-${firstClip.trackId}-${clipIds[0]}`;

      // Determine version (increments if content changed)
      const prevChain = prevChainById.get(chainId);
      const contentChanged = hasChainContentChanged(prevChain, clipIds, transitionIds, totalOverlap);
      const version = contentChanged ? (prevChain?.version ?? 0) + 1 : (prevChain?.version ?? 1);

      const chain: TransitionChain = {
        id: chainId,
        version,
        clipIds,
        transitionIds,
        trackId: firstClip.trackId,
        startFrame: firstClip.from,
        endFrame: lastClip.from + lastClip.durationInFrames,
        totalOverlap,
        renderedDuration: totalDuration - totalOverlap,
      };

      allChains.push(chain);

      // Index by track
      if (!chainsByTrackId.has(chain.trackId)) {
        chainsByTrackId.set(chain.trackId, []);
      }
      chainsByTrackId.get(chain.trackId)!.push(chain);

      // Index clips to their chain
      for (const clipId of clipIds) {
        chainByClipId.set(clipId, chain);
      }
    } else {
      // Single clip with broken transition reference - treat as standalone
      standaloneClipIds.add(chainStart.id);
    }
  }

  return { chainsByTrackId, allChains, standaloneClipIds, chainByClipId };
}

/**
 * Check if chain content has changed (for version tracking).
 * Used to determine if ChainRenderer needs to re-render.
 */
function hasChainContentChanged(
  prevChain: TransitionChain | undefined,
  clipIds: string[],
  transitionIds: string[],
  totalOverlap: number
): boolean {
  if (!prevChain) return true;

  // Compare clip count
  if (prevChain.clipIds.length !== clipIds.length) return true;

  // Compare transition count
  if (prevChain.transitionIds.length !== transitionIds.length) return true;

  // Compare overlap (indicates duration changes)
  if (prevChain.totalOverlap !== totalOverlap) return true;

  // Compare clip IDs (order matters)
  for (let i = 0; i < clipIds.length; i++) {
    if (prevChain.clipIds[i] !== clipIds[i]) return true;
  }

  // Compare transition IDs
  for (let i = 0; i < transitionIds.length; i++) {
    if (prevChain.transitionIds[i] !== transitionIds[i]) return true;
  }

  return false;
}

/**
 * Get the render offset for a clip based on chain overlaps.
 * Clips after chains need their positions adjusted because
 * transitions compress the timeline duration.
 *
 * @param chains - All pre-computed chains
 * @param trackId - Track to check
 * @param clipFrom - Original clip position
 * @returns Number of frames to subtract from render position
 */
export function getRenderOffset(
  chains: TransitionChain[],
  trackId: string,
  clipFrom: number
): number {
  let offset = 0;
  for (const chain of chains) {
    if (chain.trackId === trackId && chain.endFrame <= clipFrom) {
      offset += chain.totalOverlap;
    }
  }
  return offset;
}
