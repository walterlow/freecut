/**
 * Motion classifier for caption embedding context.
 *
 * Scene detection already emits an optical-flow `MotionResult` per
 * detected cut (`totalMotion`, `globalMotion`, `localMotion`,
 * `directionCoherence`, `dominantDirection`), but the values are raw
 * normalized floats — not something a user would type in a query.
 * This module maps them to a short English label ("static shot",
 * "slow pan", "handheld action", etc.) that both:
 *
 *   - embeds cleanly into the `MOTION:` context line so semantic
 *     queries like "action scene" find the right clips, and
 *   - renders as a chip on each scene row so users can see *why* a
 *     scene matched a motion-flavored query.
 *
 * Thresholds are tuned against the current scene-detection pipeline's
 * magnitude normalization — see `optical-flow-analyzer.ts`. They're
 * deliberately conservative; we'd rather label a shot "moderate" than
 * confidently mislabel a pan as action.
 */

export interface MotionSignal {
  totalMotion: number;
  globalMotion: number;
  localMotion: number;
  dominantDirection: number;
  directionCoherence: number;
}

export type MotionKind =
  | 'static'
  | 'pan'
  | 'tilt'
  | 'action'
  | 'busy'
  | 'moderate';

export interface MotionDescription {
  /** Coarse family — drives the chip tone and the embedding label. */
  kind: MotionKind;
  /** Human-readable label, e.g. "slow pan right" or "handheld action". */
  label: string;
  /** Copy of the raw motion magnitude [0..1] so callers can rank by intensity. */
  intensity: number;
}

// Magnitude below this we call the shot "static" regardless of anything
// else — below 0.05 is usually tripod + subject-at-rest.
const STATIC_MAX = 0.08;

// A coherent direction (> 0.4) plus non-trivial globalMotion means a
// camera move; below this threshold the flow is too scattered to be a
// pan/tilt.
const COHERENCE_MIN = 0.4;

// Above this, even coherent motion reads as fast action rather than a
// smooth camera move.
const ACTION_LOCAL_MIN = 0.45;

function directionLabel(deg: number): string {
  // Screen coordinates: 0° = right, 90° = down, 180° = left, 270° = up.
  // Map to compass directions for the label.
  const bucket = Math.round(deg / 45) % 8;
  switch (bucket) {
    case 0: return 'right';
    case 1: return 'down-right';
    case 2: return 'down';
    case 3: return 'down-left';
    case 4: return 'left';
    case 5: return 'up-left';
    case 6: return 'up';
    case 7: return 'up-right';
    default: return '';
  }
}

function intensityWord(totalMotion: number): string {
  if (totalMotion < 0.2) return 'slow';
  if (totalMotion < 0.5) return 'medium';
  return 'fast';
}

/**
 * Classify a {@link MotionSignal} into a label suitable for embedding
 * context and UI display. Returns `null` for genuinely noisy/unknown
 * input so callers know to omit the MOTION: line rather than emit
 * `"unknown"` into the embedding string.
 */
export function describeMotion(signal: MotionSignal | null | undefined): MotionDescription | null {
  if (!signal) return null;
  const { totalMotion, globalMotion, localMotion, directionCoherence, dominantDirection } = signal;

  if (totalMotion < STATIC_MAX) {
    return { kind: 'static', label: 'static shot', intensity: totalMotion };
  }

  // Coherent motion + direction → camera move.
  if (directionCoherence >= COHERENCE_MIN && globalMotion >= 0.2 && localMotion < ACTION_LOCAL_MIN) {
    const dir = directionLabel(dominantDirection);
    const speed = intensityWord(totalMotion);
    // Tilts (up/down) are distinct from pans (left/right) in editor
    // parlance, so split them out for searchability.
    const isVertical = dir === 'up' || dir === 'down';
    const kind: MotionKind = isVertical ? 'tilt' : 'pan';
    const verb = isVertical ? 'tilt' : 'pan';
    return {
      kind,
      label: dir ? `${speed} ${verb} ${dir}` : `${speed} ${verb}`,
      intensity: totalMotion,
    };
  }

  // High local motion — subjects moving within frame rather than camera.
  if (localMotion >= ACTION_LOCAL_MIN) {
    return {
      kind: 'action',
      label: totalMotion > 0.6 ? 'fast action' : 'handheld action',
      intensity: totalMotion,
    };
  }

  // Everything else is "busy" or "moderate" depending on magnitude.
  if (totalMotion >= 0.6) {
    return { kind: 'busy', label: 'busy scene', intensity: totalMotion };
  }
  return { kind: 'moderate', label: 'moderate motion', intensity: totalMotion };
}
