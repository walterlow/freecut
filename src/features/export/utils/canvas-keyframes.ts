/**
 * Canvas Keyframe Animation System
 *
 * Provides keyframe interpolation for client-side rendering.
 * Re-exports and adapts existing keyframe utilities for canvas rendering.
 */

import type { TimelineItem } from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import type { ResolvedTransform } from '@/types/transform';
import { resolveItemTransformAtFrame } from '@/features/export/deps/composition-runtime';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function interpolateLinear(start: number, end: number, progress: number): number {
  return start + ((end - start) * clamp01(progress));
}

function supportsVisualClipFade(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'composition';
}

function getVisualFadeOpacity(item: TimelineItem, frame: number, fps: number): number {
  if (!supportsVisualClipFade(item) || item.durationInFrames <= 0) {
    return 1;
  }

  if (frame < item.from || frame >= item.from + item.durationInFrames) {
    return 0;
  }

  const fadeInFrames = Math.min((item.fadeIn ?? 0) * fps, item.durationInFrames);
  const fadeOutFrames = Math.min((item.fadeOut ?? 0) * fps, item.durationInFrames);
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (!hasFadeIn && !hasFadeOut) {
    return 1;
  }

  const relativeFrame = frame - item.from;
  const fadeOutStart = item.durationInFrames - fadeOutFrames;

  if (hasFadeIn && hasFadeOut) {
    if (fadeInFrames >= fadeOutStart) {
      const midPoint = item.durationInFrames / 2;
      const peakOpacity = Math.min(1, midPoint / Math.max(fadeInFrames, 1));

      if (relativeFrame <= midPoint) {
        return interpolateLinear(0, peakOpacity, relativeFrame / Math.max(midPoint, 1));
      }

      return interpolateLinear(
        peakOpacity,
        0,
        (relativeFrame - midPoint) / Math.max(item.durationInFrames - midPoint, 1)
      );
    }

    if (relativeFrame < fadeInFrames) {
      return interpolateLinear(0, 1, relativeFrame / Math.max(fadeInFrames, 1));
    }

    if (relativeFrame < fadeOutStart) {
      return 1;
    }

    return interpolateLinear(
      1,
      0,
      (relativeFrame - fadeOutStart) / Math.max(item.durationInFrames - fadeOutStart, 1)
    );
  }

  if (hasFadeIn) {
    if (relativeFrame < fadeInFrames) {
      return interpolateLinear(0, 1, relativeFrame / Math.max(fadeInFrames, 1));
    }

    return 1;
  }

  if (relativeFrame < fadeOutStart) {
    return 1;
  }

  return interpolateLinear(
    1,
    0,
    (relativeFrame - fadeOutStart) / Math.max(item.durationInFrames - fadeOutStart, 1)
  );
}

/**
 * Canvas settings for transform resolution
 */
interface CanvasRenderSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Get the animated transform for an item at a specific frame.
 *
 * @param item - The timeline item
 * @param keyframes - Keyframes for this item (optional)
 * @param frame - Current frame (global timeline frame)
 * @param canvas - Canvas settings
 * @returns ResolvedTransform with keyframe animations applied
 */
export function getAnimatedTransform(
  item: TimelineItem,
  keyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: CanvasRenderSettings
): ResolvedTransform {
  const resolved = resolveItemTransformAtFrame(item, {
    canvas: {
      width: canvas.width,
      height: canvas.height,
      fps: canvas.fps,
    },
    frame,
    keyframes,
  });

  const fadeOpacity = getVisualFadeOpacity(item, frame, canvas.fps);
  if (fadeOpacity >= 1) {
    return resolved;
  }

  return {
    ...resolved,
    opacity: resolved.opacity * fadeOpacity,
  };
}

/**
 * Build a map of item ID to keyframes for efficient lookup
 */
export function buildKeyframesMap(
  keyframes: ItemKeyframes[] | undefined
): Map<string, ItemKeyframes> {
  const map = new Map<string, ItemKeyframes>();
  if (!keyframes) return map;

  for (const itemKeyframes of keyframes) {
    map.set(itemKeyframes.itemId, itemKeyframes);
  }

  return map;
}
