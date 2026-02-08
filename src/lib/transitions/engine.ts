/**
 * Transition Engine
 *
 * Pure calculation functions for transition effects.
 * Separates calculation logic from rendering for better testability and performance.
 *
 * Performance optimizations:
 * - All functions are pure and memoizable
 * - Pre-calculated lookup tables for expensive operations
 * - No React dependencies - can be used in workers or GPU shaders
 *
 * The engine delegates to the TransitionRegistry for style calculations
 * when a renderer is registered, falling back to built-in fade for unknown types.
 */

import type { Transition, TransitionTiming, WipeDirection, SlideDirection, FlipDirection } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';
import { springEasing, easeIn, easeOut, easeInOut, cubicBezier } from '@/features/keyframes/utils/easing';
import type { TransitionRenderer } from './registry';

// Lazy registry reference to avoid circular dependency at import time.
// The registry module imports from renderers which import engine types.
let _registryGetter: (() => { getRenderer(id: string): TransitionRenderer | undefined }) | null = null;

/** Called by index.ts after registration to provide the registry reference */
export function _setRegistryGetter(getter: typeof _registryGetter): void {
  _registryGetter = getter;
}

// ============================================================================
// Types
// ============================================================================

export interface TransitionTimingConfig {
  timing: TransitionTiming;
  fps: number;
  durationInFrames: number;
  bezierPoints?: { x1: number; y1: number; x2: number; y2: number };
}

export interface TransitionCalculation {
  progress: number; // 0 to 1
  opacity?: number;
  transform?: string;
  clipPath?: string;
  maskImage?: string;
}

export interface ActiveTransitionInfo {
  transition: Transition;
  leftClip: TimelineItem;
  rightClip: TimelineItem;
  progress: number;
  isInTransition: boolean;
  transitionStart: number;
  transitionEnd: number;
  cutPoint: number;
}

export interface TransitionStyleCalculation {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  maskImage?: string;
  webkitClipPath?: string;
  webkitMaskImage?: string;
  maskSize?: string;
  webkitMaskSize?: string;
  maskPosition?: string;
  webkitMaskPosition?: string;
}

// ============================================================================
// Progress Calculation
// ============================================================================

/**
 * Pre-calculated easing lookup table for common frame counts.
 * Avoids recalculating easing functions repeatedly.
 */
const easingCache = new Map<string, number[]>();

function getEasingCacheKey(config: TransitionTimingConfig): string {
  let key = `${config.timing}-${config.fps}-${config.durationInFrames}`;
  if (config.timing === 'cubic-bezier' && config.bezierPoints) {
    const b = config.bezierPoints;
    key += `-${b.x1}-${b.y1}-${b.x2}-${b.y2}`;
  }
  return key;
}

/**
 * Calculate easing values for all frames in a transition.
 * Results are cached for reuse.
 */
export function calculateEasingCurve(config: TransitionTimingConfig): number[] {
  const cacheKey = getEasingCacheKey(config);

  if (easingCache.has(cacheKey)) {
    return easingCache.get(cacheKey)!;
  }

  const { timing, durationInFrames, bezierPoints } = config;
  const curve: number[] = [];

  for (let frame = 0; frame < durationInFrames; frame++) {
    const linearProgress = frame / Math.max(1, durationInFrames - 1);

    switch (timing) {
      case 'spring':
        curve.push(springEasing(linearProgress, { tension: 180, friction: 12, mass: 1 }));
        break;
      case 'ease-in':
        curve.push(easeIn(linearProgress));
        break;
      case 'ease-out':
        curve.push(easeOut(linearProgress));
        break;
      case 'ease-in-out':
        curve.push(easeInOut(linearProgress));
        break;
      case 'cubic-bezier':
        if (bezierPoints) {
          curve.push(cubicBezier(linearProgress, bezierPoints));
        } else {
          curve.push(linearProgress);
        }
        break;
      default: // 'linear'
        curve.push(linearProgress);
        break;
    }
  }

  easingCache.set(cacheKey, curve);
  return curve;
}

/**
 * Get progress for a specific frame using pre-calculated curve.
 * Much faster than calculating on the fly.
 */
export function getTransitionProgress(
  frame: number,
  config: TransitionTimingConfig
): number {
  const curve = calculateEasingCurve(config);
  const index = Math.max(0, Math.min(frame, curve.length - 1));
  return curve[index] ?? 0;
}

// ============================================================================
// Presentation Calculations (built-in fallbacks)
// ============================================================================

/**
 * Calculate fade opacity using equal-power crossfade.
 */
export function calculateFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos((progress * Math.PI) / 2);
  } else {
    return Math.sin((progress * Math.PI) / 2);
  }
}

/**
 * Calculate wipe clip-path.
 */
export function calculateWipeClipPath(
  progress: number,
  direction: WipeDirection,
  isOutgoing: boolean
): string {
  const p = Math.max(0, Math.min(1, progress));
  const inverse = 1 - p;

  switch (direction) {
    case 'from-left':
      return isOutgoing
        ? `inset(0 0 0 ${p * 100}%)`
        : `inset(0 ${inverse * 100}% 0 0)`;
    case 'from-right':
      return isOutgoing
        ? `inset(0 ${p * 100}% 0 0)`
        : `inset(0 0 0 ${inverse * 100}%)`;
    case 'from-top':
      return isOutgoing
        ? `inset(${p * 100}% 0 0 0)`
        : `inset(0 0 ${inverse * 100}% 0)`;
    case 'from-bottom':
      return isOutgoing
        ? `inset(0 0 ${p * 100}% 0)`
        : `inset(${inverse * 100}% 0 0 0)`;
    default:
      return 'none';
  }
}

/**
 * Calculate slide transform.
 */
export function calculateSlideTransform(
  progress: number,
  direction: SlideDirection,
  isOutgoing: boolean,
  canvasWidth: number,
  canvasHeight: number
): string {
  const slideProgress = isOutgoing ? progress : progress - 1;

  switch (direction) {
    case 'from-left':
      return `translateX(${slideProgress * canvasWidth}px)`;
    case 'from-right':
      return `translateX(${-slideProgress * canvasWidth}px)`;
    case 'from-top':
      return `translateY(${slideProgress * canvasHeight}px)`;
    case 'from-bottom':
      return `translateY(${-slideProgress * canvasHeight}px)`;
    default:
      return 'none';
  }
}

/**
 * Calculate flip transform with proper perspective.
 */
export function calculateFlipTransform(
  progress: number,
  direction: FlipDirection,
  isOutgoing: boolean
): string {
  const axis = direction === 'from-left' || direction === 'from-right' ? 'Y' : 'X';
  const sign = direction === 'from-right' || direction === 'from-bottom' ? -1 : 1;
  const midpoint = 0.5;

  if (isOutgoing) {
    const flipProgress = Math.min(progress / midpoint, 1);
    const flipDegrees = flipProgress * 90;
    return `perspective(1000px) rotate${axis}(${sign * flipDegrees}deg)`;
  } else {
    const flipProgress = Math.max((progress - midpoint) / midpoint, 0);
    const flipDegrees = -90 + flipProgress * 90;
    return `perspective(1000px) rotate${axis}(${sign * flipDegrees}deg)`;
  }
}

/**
 * Calculate clock wipe mask.
 */
export function calculateClockWipeMask(progress: number): string {
  const degrees = progress * 360;
  return `conic-gradient(from 0deg, transparent ${degrees}deg, black ${degrees}deg)`;
}

/**
 * Calculate iris mask.
 */
export function calculateIrisMask(progress: number): string {
  const maxRadius = 120;
  const radius = progress * maxRadius;
  return `radial-gradient(circle, transparent ${radius}%, black ${radius}%)`;
}

// ============================================================================
// Full Transition Calculation (Registry-Delegated)
// ============================================================================

/**
 * Calculate all styles for a transition presentation.
 * Delegates to the registry renderer if available, otherwise uses built-in logic.
 * Returns complete style object for a clip (outgoing or incoming).
 */
export function calculateTransitionStyles(
  transition: Transition,
  progress: number,
  isOutgoing: boolean,
  canvasWidth: number,
  canvasHeight: number
): TransitionStyleCalculation {
  const { presentation, direction, properties } = transition;
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Try registry first (lazy getter to avoid circular deps at import time)
  if (_registryGetter) {
    const registry = _registryGetter();
    const renderer = registry.getRenderer(presentation);
    if (renderer) {
      return renderer.calculateStyles(
        clampedProgress,
        isOutgoing,
        canvasWidth,
        canvasHeight,
        direction,
        properties
      );
    }
  }

  // Built-in fallback for backward compatibility
  return calculateBuiltinTransitionStyles(
    presentation,
    clampedProgress,
    isOutgoing,
    canvasWidth,
    canvasHeight,
    direction
  );
}

/**
 * Built-in style calculations (the original switch-based logic).
 * Used as fallback when registry is not loaded.
 */
function calculateBuiltinTransitionStyles(
  presentation: string,
  progress: number,
  isOutgoing: boolean,
  canvasWidth: number,
  canvasHeight: number,
  direction?: WipeDirection | SlideDirection | FlipDirection
): TransitionStyleCalculation {
  const midpoint = 0.5;

  switch (presentation) {
    case 'fade': {
      return { opacity: calculateFadeOpacity(progress, isOutgoing) };
    }
    case 'wipe': {
      const clipPath = calculateWipeClipPath(
        progress,
        (direction as WipeDirection) || 'from-left',
        isOutgoing
      );
      return { clipPath, webkitClipPath: clipPath };
    }
    case 'slide': {
      return {
        transform: calculateSlideTransform(progress, (direction as SlideDirection) || 'from-left', isOutgoing, canvasWidth, canvasHeight),
      };
    }
    case 'flip': {
      const flipOpacity = isOutgoing
        ? progress < midpoint ? 1 : 0
        : progress >= midpoint ? 1 : 0;
      return {
        transform: calculateFlipTransform(progress, (direction as FlipDirection) || 'from-left', isOutgoing),
        opacity: flipOpacity,
      };
    }
    case 'clockWipe': {
      if (isOutgoing) {
        const maskImage = calculateClockWipeMask(progress);
        return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
      }
      return {};
    }
    case 'iris': {
      if (isOutgoing) {
        const maskImage = calculateIrisMask(progress);
        return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
      }
      return {};
    }
    case 'none': {
      return {
        opacity: isOutgoing
          ? progress < midpoint ? 1 : 0
          : progress >= midpoint ? 1 : 0,
      };
    }
    default:
      return { opacity: calculateFadeOpacity(progress, isOutgoing) };
  }
}

// ============================================================================
// Active Transition Detection
// ============================================================================

/**
 * Compute the start frame of a transition using alignment.
 * alignment=0.5 (default) centers on cut point (backward compatible).
 */
function computeTransitionStart(cutPoint: number, duration: number, alignment: number): number {
  // leftPortion = how much of the transition falls in the outgoing (left) clip
  const leftPortion = Math.floor(duration * alignment);
  return cutPoint - leftPortion;
}

/**
 * Build a map of clip IDs to clips for quick lookup.
 */
export function buildClipMap(clips: TimelineItem[]): Map<string, TimelineItem> {
  const map = new Map<string, TimelineItem>();
  for (const clip of clips) {
    map.set(clip.id, clip);
  }
  return map;
}

/**
 * Find all active transitions at a given frame.
 * Optimized to avoid creating intermediate arrays when possible.
 */
export function findActiveTransitions(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>,
  frame: number,
  fps: number
): ActiveTransitionInfo[] {
  const active: ActiveTransitionInfo[] = [];

  for (const transition of transitions) {
    const leftClip = clipMap.get(transition.leftClipId);
    const rightClip = clipMap.get(transition.rightClipId);

    if (!leftClip || !rightClip) continue;

    const cutPoint = leftClip.from + leftClip.durationInFrames;
    const alignment = transition.alignment ?? 0.5;
    const transitionStart = computeTransitionStart(cutPoint, transition.durationInFrames, alignment);
    const transitionEnd = transitionStart + transition.durationInFrames;

    if (frame >= transitionStart && frame < transitionEnd) {
      const localFrame = frame - transitionStart;
      const progress = getTransitionProgress(localFrame, {
        timing: transition.timing,
        fps,
        durationInFrames: transition.durationInFrames,
        bezierPoints: transition.bezierPoints,
      });

      active.push({
        transition,
        leftClip,
        rightClip,
        progress,
        isInTransition: true,
        transitionStart,
        transitionEnd,
        cutPoint,
      });
    }
  }

  return active;
}

/**
 * Check if a specific frame is within any transition.
 */
export function isFrameInTransition(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>,
  frame: number
): boolean {
  for (const transition of transitions) {
    const leftClip = clipMap.get(transition.leftClipId);
    if (!leftClip) continue;

    const cutPoint = leftClip.from + leftClip.durationInFrames;
    const alignment = transition.alignment ?? 0.5;
    const transitionStart = computeTransitionStart(cutPoint, transition.durationInFrames, alignment);
    const transitionEnd = transitionStart + transition.durationInFrames;

    if (frame >= transitionStart && frame < transitionEnd) {
      return true;
    }
  }
  return false;
}

/**
 * Get all clip IDs involved in transitions at a given frame.
 */
export function getTransitionClipIds(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>,
  frame: number
): Set<string> {
  const clipIds = new Set<string>();

  for (const transition of transitions) {
    const leftClip = clipMap.get(transition.leftClipId);
    if (!leftClip) continue;

    const cutPoint = leftClip.from + leftClip.durationInFrames;
    const alignment = transition.alignment ?? 0.5;
    const transitionStart = computeTransitionStart(cutPoint, transition.durationInFrames, alignment);
    const transitionEnd = transitionStart + transition.durationInFrames;

    if (frame >= transitionStart && frame < transitionEnd) {
      clipIds.add(transition.leftClipId);
      clipIds.add(transition.rightClipId);
    }
  }

  return clipIds;
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear the easing cache.
 * Call this when memory pressure is high or for testing.
 */
export function clearEasingCache(): void {
  easingCache.clear();
}

/**
 * Get cache statistics for debugging.
 */
export function getEasingCacheStats(): { size: number; keys: string[] } {
  return {
    size: easingCache.size,
    keys: Array.from(easingCache.keys()),
  };
}
