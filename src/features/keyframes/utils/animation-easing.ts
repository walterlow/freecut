/**
 * Shared easing + timing primitives for the built-in animation preset engines
 * (text-animation presets and the Animate-workspace motion presets). Pure, no
 * store access. Keeping the curves and the clip-clamped window math in one place
 * means both engines settle with the same feel.
 */

import type { EasingConfig } from '@/types/keyframe'

/** Soft ease-out used as the settle curve for intros/entrances. */
export const EASE_OUT_SOFT: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
}

/** Soft ease-in used as the lead-out curve for outros/exits. */
export const EASE_IN_SOFT: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 },
}

/** Gentle spring that settles a moving property onto its resting value. */
export const SPRING_SETTLE: EasingConfig = {
  type: 'spring',
  spring: { tension: 220, friction: 18, mass: 0.9 },
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Length in frames of a one-shot animation window, clamped so it always fits
 * inside the clip. Returns 0 for degenerate single-frame clips (nothing to
 * animate).
 */
export function animationWindowFrames(
  seconds: number,
  durationInFrames: number,
  fps: number,
): number {
  if (durationInFrames <= 1) {
    return 0
  }
  return Math.max(1, Math.min(durationInFrames - 1, Math.round(fps * seconds)))
}
