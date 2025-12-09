/**
 * Transition Chain Store
 *
 * Derived state store that pre-computes transition chains and indexes.
 * Subscribes to timeline-store and recomputes only when items/transitions change.
 *
 * This replaces the per-render groupClipsIntoChains() call in MainComposition,
 * moving chain computation from 30-60x/sec to only when data actually changes.
 *
 * Performance benefits:
 * - O(1) transition lookups via indexes
 * - Chains computed once when data changes, not every frame
 * - Version tracking enables efficient React.memo comparisons
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { useTimelineStore } from './timeline-store';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type {
  Transition,
  TransitionChain,
  ClipTransitionIndex,
} from '@/types/transition';
import {
  buildTransitionIndexes,
  buildTransitionChains,
  type TransitionIndexes,
  type TransitionChainResult,
} from '../utils/transition-indexes';

/**
 * Enriched visual item with track metadata for rendering.
 * Matches the structure expected by MainComposition.
 */
export type EnrichedVisualItem = TimelineItem & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

interface TransitionChainState {
  // Pre-computed indexes
  transitionsByClipId: Map<string, ClipTransitionIndex>;
  transitionsByTrackId: Map<string, Transition[]>;
  transitionsById: Map<string, Transition>;

  // Pre-computed chains
  chains: TransitionChain[];
  chainsByTrackId: Map<string, TransitionChain[]>;
  standaloneClipIds: Set<string>;
  chainByClipId: Map<string, TransitionChain>;

  // Enriched items for rendering
  enrichedItemsById: Map<string, EnrichedVisualItem>;

  // Version tracking for cache invalidation
  computeVersion: number;
}

interface TransitionChainActions {
  /**
   * Recompute all indexes and chains from timeline data.
   * Called automatically when timeline-store changes.
   */
  recompute: (
    items: TimelineItem[],
    transitions: Transition[],
    tracks: TimelineTrack[]
  ) => void;

  /**
   * Get enriched visual items for a track (for rendering).
   */
  getEnrichedItemsForTrack: (trackId: string) => EnrichedVisualItem[];

  /**
   * Get the chain containing a specific clip.
   */
  getChainForClip: (clipId: string) => TransitionChain | undefined;

  /**
   * Get transition between two clips (if exists).
   */
  getTransitionBetween: (
    leftClipId: string,
    rightClipId: string
  ) => Transition | undefined;

  /**
   * Calculate render offset for a clip based on chain overlaps.
   */
  getRenderOffset: (trackId: string, clipFrom: number) => number;
}

type TransitionChainStore = TransitionChainState & TransitionChainActions;

export const useTransitionChainStore = create<TransitionChainStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state (empty)
    transitionsByClipId: new Map(),
    transitionsByTrackId: new Map(),
    transitionsById: new Map(),
    chains: [],
    chainsByTrackId: new Map(),
    standaloneClipIds: new Set(),
    chainByClipId: new Map(),
    enrichedItemsById: new Map(),
    computeVersion: 0,

    recompute: (items, transitions, tracks) => {
      const state = get();

      // Build transition indexes
      const indexes: TransitionIndexes = buildTransitionIndexes(transitions);

      // Build enriched items map
      const enrichedItemsById = new Map<string, EnrichedVisualItem>();
      const maxOrder = Math.max(...tracks.map((t) => t.order ?? 0), 0);

      for (const track of tracks) {
        for (const item of items.filter((i) => i.trackId === track.id)) {
          if (item.type === 'video' || item.type === 'image') {
            enrichedItemsById.set(item.id, {
              ...item,
              zIndex: maxOrder - (track.order ?? 0),
              muted: track.muted ?? false,
              trackOrder: track.order ?? 0,
              trackVisible: track.visible !== false,
            } as EnrichedVisualItem);
          }
        }
      }

      // Build chains
      const chainResult: TransitionChainResult = buildTransitionChains(
        items,
        transitions,
        indexes.transitionsByClipId,
        state.chains // Pass previous chains for version comparison
      );

      set({
        transitionsByClipId: indexes.transitionsByClipId,
        transitionsByTrackId: indexes.transitionsByTrackId,
        transitionsById: indexes.transitionsById,
        chains: chainResult.allChains,
        chainsByTrackId: chainResult.chainsByTrackId,
        standaloneClipIds: chainResult.standaloneClipIds,
        chainByClipId: chainResult.chainByClipId,
        enrichedItemsById,
        computeVersion: state.computeVersion + 1,
      });
    },

    getEnrichedItemsForTrack: (trackId) => {
      const { enrichedItemsById } = get();
      const items: EnrichedVisualItem[] = [];
      for (const item of enrichedItemsById.values()) {
        if (item.trackId === trackId) {
          items.push(item);
        }
      }
      return items.sort((a, b) => a.from - b.from);
    },

    getChainForClip: (clipId) => {
      return get().chainByClipId.get(clipId);
    },

    getTransitionBetween: (leftClipId, rightClipId) => {
      const { transitionsByClipId } = get();
      const leftIndex = transitionsByClipId.get(leftClipId);
      if (
        leftIndex?.outgoing &&
        leftIndex.outgoing.rightClipId === rightClipId
      ) {
        return leftIndex.outgoing;
      }
      return undefined;
    },

    getRenderOffset: (trackId, clipFrom) => {
      const { chains } = get();
      let offset = 0;
      for (const chain of chains) {
        if (chain.trackId === trackId && chain.endFrame <= clipFrom) {
          offset += chain.totalOverlap;
        }
      }
      return offset;
    },
  }))
);

/**
 * Initialize subscription to timeline-store.
 * This sets up automatic recomputation when timeline data changes.
 */
export function initTransitionChainSubscription(): () => void {
  // Get initial data and compute
  const timelineState = useTimelineStore.getState();
  useTransitionChainStore
    .getState()
    .recompute(
      timelineState.items,
      timelineState.transitions,
      timelineState.tracks
    );

  // Subscribe to changes
  const unsubscribe = useTimelineStore.subscribe(
    (state: { items: TimelineItem[]; transitions: Transition[]; tracks: TimelineTrack[] }) => ({
      items: state.items,
      transitions: state.transitions,
      tracks: state.tracks,
    }),
    (slice: { items: TimelineItem[]; transitions: Transition[]; tracks: TimelineTrack[] }) => {
      useTransitionChainStore
        .getState()
        .recompute(slice.items, slice.transitions, slice.tracks);
    },
    { equalityFn: shallow }
  );

  return unsubscribe;
}

// Selectors for efficient component subscriptions

/**
 * Select all chains (for MainComposition)
 */
export const selectChains = (state: TransitionChainStore) => state.chains;

/**
 * Select standalone clip IDs
 */
export const selectStandaloneClipIds = (state: TransitionChainStore) =>
  state.standaloneClipIds;

/**
 * Select chains for a specific track
 */
export const selectChainsForTrack =
  (trackId: string) => (state: TransitionChainStore) =>
    state.chainsByTrackId.get(trackId) ?? [];

/**
 * Select transition indexes by clip
 */
export const selectTransitionsByClipId = (state: TransitionChainStore) =>
  state.transitionsByClipId;

/**
 * Select compute version (for cache invalidation)
 */
export const selectComputeVersion = (state: TransitionChainStore) =>
  state.computeVersion;
