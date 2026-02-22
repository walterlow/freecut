import type { Transition } from '@/types/transition';
import type { TrimHandle } from './trim-utils';

/**
 * Returns true when trimming this item edge would directly edit a transition bridge.
 * - start edge: item is transition incoming clip (rightClipId)
 * - end edge: item is transition outgoing clip (leftClipId)
 */
export function hasTransitionBridgeAtHandle(
  transitions: Transition[],
  itemId: string,
  handle: TrimHandle,
): boolean {
  if (handle === 'start') {
    return transitions.some((t) => t.rightClipId === itemId);
  }
  return transitions.some((t) => t.leftClipId === itemId);
}

/**
 * Returns true when any of the provided clip IDs participates in any transition.
 */
export function hasAnyTransitionBridge(
  transitions: Transition[],
  itemIds: Iterable<string>,
): boolean {
  const ids = new Set(itemIds);
  if (ids.size === 0) return false;
  return transitions.some((t) => ids.has(t.leftClipId) || ids.has(t.rightClipId));
}

