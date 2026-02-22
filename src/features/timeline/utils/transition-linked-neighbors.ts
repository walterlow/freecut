import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { TrimHandle } from './trim-utils';

interface NeighborPair {
  leftNeighbor: TimelineItem | null;
  rightNeighbor: TimelineItem | null;
}

function findAdjacentNeighbors(
  item: TimelineItem,
  items: TimelineItem[],
): NeighborPair {
  const itemEnd = item.from + item.durationInFrames;
  let leftNeighbor: TimelineItem | null = null;
  let rightNeighbor: TimelineItem | null = null;

  for (const other of items) {
    if (other.id === item.id || other.trackId !== item.trackId) continue;

    const otherEnd = other.from + other.durationInFrames;

    if (otherEnd === item.from) {
      if (!leftNeighbor || other.from > leftNeighbor.from) {
        leftNeighbor = other;
      }
    }

    if (other.from === itemEnd) {
      if (!rightNeighbor || other.from < rightNeighbor.from) {
        rightNeighbor = other;
      }
    }
  }

  return { leftNeighbor, rightNeighbor };
}

function findTransitionLinkedNeighbors(
  item: TimelineItem,
  itemsById: Map<string, TimelineItem>,
  transitions: Transition[],
): NeighborPair {
  let leftNeighbor: TimelineItem | null = null;
  let rightNeighbor: TimelineItem | null = null;

  for (const transition of transitions) {
    if (transition.rightClipId === item.id) {
      const candidate = itemsById.get(transition.leftClipId);
      if (candidate && candidate.trackId === item.trackId) {
        leftNeighbor = candidate;
      }
    }
    if (transition.leftClipId === item.id) {
      const candidate = itemsById.get(transition.rightClipId);
      if (candidate && candidate.trackId === item.trackId) {
        rightNeighbor = candidate;
      }
    }
  }

  return { leftNeighbor, rightNeighbor };
}

/**
 * Resolve edit neighbors with transition awareness.
 * Prefer strict edge-adjacent neighbors, fallback to transition-linked neighbors.
 */
export function findEditNeighborsWithTransitions(
  item: TimelineItem,
  items: TimelineItem[],
  transitions: Transition[],
): NeighborPair {
  const adjacent = findAdjacentNeighbors(item, items);
  if (adjacent.leftNeighbor && adjacent.rightNeighbor) return adjacent;

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const linked = findTransitionLinkedNeighbors(item, itemsById, transitions);

  return {
    leftNeighbor: adjacent.leftNeighbor ?? linked.leftNeighbor,
    rightNeighbor: adjacent.rightNeighbor ?? linked.rightNeighbor,
  };
}

export function findHandleNeighborWithTransitions(
  item: TimelineItem,
  handle: TrimHandle,
  items: TimelineItem[],
  transitions: Transition[],
): TimelineItem | null {
  const { leftNeighbor, rightNeighbor } = findEditNeighborsWithTransitions(item, items, transitions);
  return handle === 'start' ? leftNeighbor : rightNeighbor;
}

