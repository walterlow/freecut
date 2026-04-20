import { calculateTransitionPortions } from '@/core/timeline/transitions/transition-planner';

export interface RollingPreviewLike {
  trimmedItemId: string | null;
  neighborItemId: string | null;
  handle: 'start' | 'end' | null;
  delta: number;
}

export interface SlidePreviewLike {
  itemId: string | null;
  leftNeighborId: string | null;
  rightNeighborId: string | null;
  delta: number;
}

export interface RipplePreviewLike {
  trimmedItemId: string | null;
  delta: number;
  isDownstream: boolean;
}

export interface LinkedEditPreviewLike {
  from?: number;
  durationInFrames?: number;
  hidden?: boolean;
}

export interface TrackPushPreviewLike {
  delta: number;
  isShifted: boolean;
}

export interface PreviewAdjustments {
  rolling: RollingPreviewLike;
  slide: SlidePreviewLike;
  ripple: RipplePreviewLike;
  linkedEdit?: LinkedEditPreviewLike | null;
  trackPush?: TrackPushPreviewLike;
}

export interface PreviewGeometry {
  from: number;
  durationInFrames: number;
}

/**
 * Apply timeline preview deltas to clip geometry without mutating timeline state.
 * Used by transition overlay rendering so bridges move in real time during edits.
 */
export function applyPreviewGeometryToClip(
  clipId: string,
  baseFrom: number,
  baseDurationInFrames: number,
  adjustments: PreviewAdjustments,
): PreviewGeometry {
  let from = baseFrom;
  let durationInFrames = baseDurationInFrames;

  const { slide, rolling, ripple } = adjustments;

  // Slide preview
  if (slide.itemId === clipId) {
    from += slide.delta;
  }
  if (slide.leftNeighborId === clipId) {
    durationInFrames += slide.delta;
  }
  if (slide.rightNeighborId === clipId) {
    from += slide.delta;
    durationInFrames -= slide.delta;
  }

  // Rolling preview
  if (rolling.trimmedItemId === clipId && rolling.handle === 'start') {
    from += rolling.delta;
    durationInFrames -= rolling.delta;
  }
  if (rolling.trimmedItemId === clipId && rolling.handle === 'end') {
    durationInFrames += rolling.delta;
  }
  if (rolling.neighborItemId === clipId && rolling.handle === 'start') {
    durationInFrames += rolling.delta;
  }
  if (rolling.neighborItemId === clipId && rolling.handle === 'end') {
    from += rolling.delta;
    durationInFrames -= rolling.delta;
  }

  // Ripple preview
  if (ripple.trimmedItemId === clipId) {
    durationInFrames += ripple.delta;
  }
  if (ripple.isDownstream && ripple.trimmedItemId != null && ripple.trimmedItemId !== clipId) {
    from += ripple.delta;
  }

  // Track push preview: shifted items move by delta
  if (adjustments.trackPush?.isShifted) {
    from += adjustments.trackPush.delta;
  }

  // Linked edit preview (rate stretch and other generic previews)
  const { linkedEdit } = adjustments;
  if (linkedEdit) {
    if (linkedEdit.from !== undefined) from = linkedEdit.from;
    if (linkedEdit.durationInFrames !== undefined) durationInFrames = linkedEdit.durationInFrames;
  }

  return {
    from,
    durationInFrames: Math.max(1, durationInFrames),
  };
}

export function getTransitionBridgeBounds(
  leftClipFrom: number,
  leftClipDurationInFrames: number,
  rightClipFrom: number,
  transitionDurationInFrames: number,
  alignment: number | undefined = 0.5,
): { leftFrame: number; rightFrame: number } {
  const leftEnd = leftClipFrom + leftClipDurationInFrames;

  if (Math.abs(leftEnd - rightClipFrom) <= 1) {
    const portions = calculateTransitionPortions(transitionDurationInFrames, alignment);
    return {
      leftFrame: leftEnd - portions.leftPortion,
      rightFrame: rightClipFrom + portions.rightPortion,
    };
  }

  return {
    leftFrame: leftEnd - transitionDurationInFrames,
    rightFrame: leftEnd,
  };
}
