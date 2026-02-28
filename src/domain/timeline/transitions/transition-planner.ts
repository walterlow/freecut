import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';

const FRAME_EPSILON = 1;

interface TransitionPortions {
  leftPortion: number;
  rightPortion: number;
}

export interface ResolvedTransitionWindow<T extends TimelineItem = TimelineItem> {
  transition: Transition;
  leftClip: T;
  rightClip: T;
  cutPoint: number;
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
  leftPortion: number;
  rightPortion: number;
}

interface MutableResolvedTransition<T extends TimelineItem> {
  transition: Transition;
  leftClip: T;
  rightClip: T;
  cutPoint: number;
  leftPortion: number;
  rightPortion: number;
}

function clampTransitionAlignment(alignment: number | undefined): number {
  const value = alignment ?? 0.5;
  return Math.max(0, Math.min(1, value));
}

export function calculateTransitionPortions(
  durationInFrames: number,
  alignment: number | undefined
): TransitionPortions {
  const safeDuration = Math.max(1, Math.floor(durationInFrames));
  const clampedAlignment = clampTransitionAlignment(alignment);
  const leftPortion = Math.floor(safeDuration * clampedAlignment);
  const rightPortion = safeDuration - leftPortion;
  return { leftPortion, rightPortion };
}

function solveClipTransitionPressure(
  clipDuration: number,
  incomingPortion: number,
  outgoingPortion: number
): { incomingPortion: number; outgoingPortion: number } {
  const available = Math.max(0, Math.floor(clipDuration));
  const startUse = Math.max(0, Math.floor(incomingPortion));
  const endUse = Math.max(0, Math.floor(outgoingPortion));
  const totalUse = startUse + endUse;

  if (totalUse <= available) {
    return { incomingPortion: startUse, outgoingPortion: endUse };
  }

  if (available === 0) {
    return { incomingPortion: 0, outgoingPortion: 0 };
  }

  const scale = available / totalUse;
  let newStart = Math.floor(startUse * scale);
  let newEnd = Math.floor(endUse * scale);

  let remaining = available - (newStart + newEnd);
  while (remaining > 0) {
    const startGain = startUse - newStart;
    const endGain = endUse - newEnd;

    if (startGain === 0 && endGain === 0) break;

    if (startGain >= endGain && startGain > 0) {
      newStart += 1;
    } else if (endGain > 0) {
      newEnd += 1;
    } else if (startGain > 0) {
      newStart += 1;
    }

    remaining -= 1;
  }

  return { incomingPortion: newStart, outgoingPortion: newEnd };
}

export function resolveTransitionWindows(
  transitions: Transition[],
  clipsById: Map<string, TimelineItem>
): ResolvedTransitionWindow[];
export function resolveTransitionWindows<T extends TimelineItem>(
  transitions: Transition[],
  clipsById: Map<string, T>
): ResolvedTransitionWindow<T>[];
export function resolveTransitionWindows<T extends TimelineItem>(
  transitions: Transition[],
  clipsById: Map<string, T>
): ResolvedTransitionWindow<T>[] {
  const resolvedByTransitionId = new Map<string, MutableResolvedTransition<T>>();
  const incomingTransitionByClipId = new Map<string, string>();
  const outgoingTransitionByClipId = new Map<string, string>();

  for (const transition of transitions) {
    const leftClip = clipsById.get(transition.leftClipId);
    const rightClip = clipsById.get(transition.rightClipId);
    if (!leftClip || !rightClip) continue;

    // Overlap model: right clip starts BEFORE left clip ends
    const leftEnd = leftClip.from + leftClip.durationInFrames;
    const overlapStart = rightClip.from;
    const overlapEnd = leftEnd;

    // No overlap means no active transition
    if (overlapEnd <= overlapStart + FRAME_EPSILON) continue;

    const durationInFrames = overlapEnd - overlapStart;
    // cutPoint is where the left clip ends (the original cut position before overlap)
    const cutPoint = overlapEnd;

    resolvedByTransitionId.set(transition.id, {
      transition,
      leftClip,
      rightClip,
      cutPoint,
      // Entire overlap is within both clips
      leftPortion: durationInFrames,
      rightPortion: durationInFrames,
    });

    outgoingTransitionByClipId.set(leftClip.id, transition.id);
    incomingTransitionByClipId.set(rightClip.id, transition.id);
  }

  // Solve transition pressure for clips that participate in two transitions
  for (const [clipId, incomingTransitionId] of incomingTransitionByClipId) {
    const outgoingTransitionId = outgoingTransitionByClipId.get(clipId);
    if (!outgoingTransitionId) continue;

    const incomingTransition = resolvedByTransitionId.get(incomingTransitionId);
    const outgoingTransition = resolvedByTransitionId.get(outgoingTransitionId);
    const clip = clipsById.get(clipId);
    if (!incomingTransition || !outgoingTransition || !clip) continue;

    const adjusted = solveClipTransitionPressure(
      clip.durationInFrames,
      incomingTransition.rightPortion,
      outgoingTransition.leftPortion
    );

    incomingTransition.rightPortion = adjusted.incomingPortion;
    outgoingTransition.leftPortion = adjusted.outgoingPortion;
  }

  const windows: ResolvedTransitionWindow<T>[] = [];
  for (const resolved of resolvedByTransitionId.values()) {
    const leftClip = resolved.leftClip;
    const rightClip = resolved.rightClip;
    const leftEnd = leftClip.from + leftClip.durationInFrames;

    // In overlap model, the window is the overlap region
    const startFrame = rightClip.from;
    const endFrame = leftEnd;
    const durationInFrames = Math.max(1, endFrame - startFrame);

    windows.push({
      transition: resolved.transition,
      leftClip: resolved.leftClip,
      rightClip: resolved.rightClip,
      cutPoint: resolved.cutPoint,
      startFrame,
      endFrame,
      durationInFrames,
      leftPortion: Math.max(0, resolved.leftPortion),
      rightPortion: Math.max(0, resolved.rightPortion),
    });
  }

  return windows.toSorted((a, b) => {
    if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
    if (a.cutPoint !== b.cutPoint) return a.cutPoint - b.cutPoint;
    return a.transition.id.localeCompare(b.transition.id);
  });
}

