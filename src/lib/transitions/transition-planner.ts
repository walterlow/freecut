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

function areFramesAligned(leftEnd: number, rightStart: number): boolean {
  return Math.abs(leftEnd - rightStart) <= FRAME_EPSILON;
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

    const leftEnd = leftClip.from + leftClip.durationInFrames;
    if (!areFramesAligned(leftEnd, rightClip.from)) continue;
    const cutPoint = rightClip.from;

    const portions = calculateTransitionPortions(
      transition.durationInFrames,
      transition.alignment
    );

    resolvedByTransitionId.set(transition.id, {
      transition,
      leftClip,
      rightClip,
      cutPoint,
      leftPortion: portions.leftPortion,
      rightPortion: portions.rightPortion,
    });

    outgoingTransitionByClipId.set(leftClip.id, transition.id);
    incomingTransitionByClipId.set(rightClip.id, transition.id);
  }

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
    const leftPortion = Math.max(0, resolved.leftPortion);
    const rightPortion = Math.max(0, resolved.rightPortion);
    const durationInFrames = Math.max(1, leftPortion + rightPortion);
    const startFrame = resolved.cutPoint - leftPortion;
    const endFrame = startFrame + durationInFrames;

    windows.push({
      transition: resolved.transition,
      leftClip: resolved.leftClip,
      rightClip: resolved.rightClip,
      cutPoint: resolved.cutPoint,
      startFrame,
      endFrame,
      durationInFrames,
      leftPortion,
      rightPortion,
    });
  }

  return windows.toSorted((a, b) => {
    if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
    if (a.cutPoint !== b.cutPoint) return a.cutPoint - b.cutPoint;
    return a.transition.id.localeCompare(b.transition.id);
  });
}

