/**
 * Pair each caption with the motion signal of its nearest scene cut.
 *
 * Scene detection stores optical-flow measurements only at cut points
 * (sparse), while captions are sampled at a regular interval (dense).
 * This utility walks both lists once and attaches the nearest cut's
 * motion to each caption — as long as that cut is within a reasonable
 * time window. Outside the window we leave `motion` absent so the
 * ranker treats the caption as unlabeled rather than mis-tagging it
 * with an unrelated shot's motion.
 */

import { describeMotion, type MotionSignal } from '../deps/analysis';

export interface CaptionMotionInput {
  timeSec: number;
}

export interface SceneCutLike {
  time: number;
  motion: MotionSignal;
}

export interface CaptionMotion {
  kind: string;
  label: string;
  intensity: number;
}

/** Maximum time distance to accept a cut→caption pairing. */
const DEFAULT_PAIR_WINDOW_SEC = 4;

/**
 * Returns an array parallel to `captions` where each entry is either the
 * classified motion for that caption (taken from its nearest cut within
 * the window) or `null` when no cut was close enough.
 */
export function pairCaptionsWithMotion(
  captions: CaptionMotionInput[],
  cuts: SceneCutLike[] | null | undefined,
  windowSec: number = DEFAULT_PAIR_WINDOW_SEC,
): Array<CaptionMotion | null> {
  if (!cuts || cuts.length === 0 || captions.length === 0) {
    return captions.map(() => null);
  }

  // Sort cuts by time (the stored order usually is, but we don't want
  // to trust the disk format and end up with a busted pairing).
  const sorted = [...cuts].sort((a, b) => a.time - b.time);

  return captions.map((caption) => {
    const t = caption.timeSec;
    // Binary search would be faster but caption counts are small
    // (≤ hundreds) so linear scan is fine and avoids the off-by-one pitfall.
    let nearest: SceneCutLike | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (const cut of sorted) {
      const delta = Math.abs(cut.time - t);
      if (delta < nearestDelta) {
        nearest = cut;
        nearestDelta = delta;
      } else if (cut.time > t + windowSec) {
        // Cuts are sorted ascending, so once we've gone past the window
        // we can bail.
        break;
      }
    }
    if (!nearest || nearestDelta > windowSec) return null;
    const description = describeMotion(nearest.motion);
    if (!description) return null;
    return {
      kind: description.kind,
      label: description.label,
      intensity: description.intensity,
    };
  });
}
