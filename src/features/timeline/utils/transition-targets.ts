import { TRANSITION_CONFIGS, type Transition } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';
import {
  areFramesAligned,
  getMaxTransitionDurationForHandles,
} from './transition-utils';

export interface ResolvedTransitionTarget {
  leftClipId: string;
  rightClipId: string;
  leftClip: TimelineItem;
  rightClip: TimelineItem;
  hasExisting: boolean;
  existingTransitionId?: string;
  canApply: boolean;
  maxDurationInFrames: number;
  suggestedDurationInFrames: number;
  alignment: number;
  reason?: string;
}

type TransitionEdge = 'left' | 'right';

function isTransitionableItem(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'image';
}

function buildExistingTransitionByPair(transitions: Transition[]): Map<string, Transition> {
  return new Map(transitions.map((transition) => [`${transition.leftClipId}->${transition.rightClipId}`, transition]));
}

function resolveTargetForPair(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  transitions: Transition[],
  preferredDurationInFrames: number,
  alignment = 0.5,
): ResolvedTransitionTarget | null {
  if (!isTransitionableItem(leftClip) || !isTransitionableItem(rightClip)) return null;
  if (leftClip.trackId !== rightClip.trackId) return null;

  const leftEnd = leftClip.from + leftClip.durationInFrames;
  if (!areFramesAligned(leftEnd, rightClip.from)) return null;

  const existingTransition = buildExistingTransitionByPair(transitions).get(`${leftClip.id}->${rightClip.id}`);
  if (existingTransition) {
    return {
      leftClipId: leftClip.id,
      rightClipId: rightClip.id,
      leftClip,
      rightClip,
      hasExisting: true,
      existingTransitionId: existingTransition.id,
      canApply: true,
      maxDurationInFrames: existingTransition.durationInFrames,
      suggestedDurationInFrames: existingTransition.durationInFrames,
      alignment: existingTransition.alignment ?? alignment,
    };
  }

  const maxDurationInFrames = getMaxTransitionDurationForHandles(leftClip, rightClip, alignment);
  if (maxDurationInFrames < 1) {
    return {
      leftClipId: leftClip.id,
      rightClipId: rightClip.id,
      leftClip,
      rightClip,
      hasExisting: false,
      canApply: false,
      maxDurationInFrames: 0,
      suggestedDurationInFrames: 0,
      alignment,
      reason: 'Not enough source handle for a transition at this cut',
    };
  }

  return {
    leftClipId: leftClip.id,
    rightClipId: rightClip.id,
    leftClip,
    rightClip,
    hasExisting: false,
    canApply: true,
    maxDurationInFrames,
    suggestedDurationInFrames: Math.max(1, Math.min(preferredDurationInFrames, maxDurationInFrames)),
    alignment,
  };
}

export function resolveTransitionTargetForEdge(params: {
  itemId: string;
  edge: TransitionEdge;
  items: TimelineItem[];
  transitions: Transition[];
  preferredDurationInFrames?: number;
  alignment?: number;
}): ResolvedTransitionTarget | null {
  const {
    itemId,
    edge,
    items,
    transitions,
    preferredDurationInFrames = TRANSITION_CONFIGS.crossfade.defaultDuration,
    alignment = 0.5,
  } = params;

  const item = items.find((candidate) => candidate.id === itemId);
  if (!item || !isTransitionableItem(item)) return null;

  const trackItems = items
    .filter((candidate) => candidate.trackId === item.trackId && isTransitionableItem(candidate))
    .toSorted((a, b) => (a.from - b.from) || a.id.localeCompare(b.id));

  if (edge === 'right') {
    const rightClip = trackItems.find((candidate) => (
      candidate.id !== item.id && areFramesAligned(item.from + item.durationInFrames, candidate.from)
    ));
    return rightClip
      ? resolveTargetForPair(item, rightClip, transitions, preferredDurationInFrames, alignment)
      : null;
  }

  const leftClip = trackItems.findLast((candidate) => (
    candidate.id !== item.id && areFramesAligned(candidate.from + candidate.durationInFrames, item.from)
  ));
  return leftClip
    ? resolveTargetForPair(leftClip, item, transitions, preferredDurationInFrames, alignment)
    : null;
}

export function resolveTransitionTargetFromSelection(params: {
  selectedItemIds: string[];
  items: TimelineItem[];
  transitions: Transition[];
  preferredDurationInFrames?: number;
  alignment?: number;
}): ResolvedTransitionTarget | null {
  const {
    selectedItemIds,
    items,
    transitions,
    preferredDurationInFrames = TRANSITION_CONFIGS.crossfade.defaultDuration,
    alignment = 0.5,
  } = params;

  if (selectedItemIds.length !== 1) return null;
  const itemId = selectedItemIds[0]!;

  const rightTarget = resolveTransitionTargetForEdge({
    itemId,
    edge: 'right',
    items,
    transitions,
    preferredDurationInFrames,
    alignment,
  });
  if (rightTarget && (rightTarget.hasExisting || rightTarget.canApply)) {
    return rightTarget;
  }

  const leftTarget = resolveTransitionTargetForEdge({
    itemId,
    edge: 'left',
    items,
    transitions,
    preferredDurationInFrames,
    alignment,
  });
  if (leftTarget && (leftTarget.hasExisting || leftTarget.canApply)) {
    return leftTarget;
  }

  return rightTarget ?? leftTarget ?? null;
}
