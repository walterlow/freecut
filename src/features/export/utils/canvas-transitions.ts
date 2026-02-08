/**
 * Canvas Transition Rendering System
 *
 * Renders visual transitions between adjacent clips for client-side export.
 * Supports all presentation types: fade, wipe, slide, flip, clockWipe, iris.
 */

import type { Transition, WipeDirection, SlideDirection, FlipDirection } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';
import { springEasing, easeIn, easeOut, easeInOut, cubicBezier } from '@/features/keyframes/utils/easing';
import { transitionRegistry } from '@/lib/transitions/registry';
import { resolveTransitionWindows } from '@/lib/transitions/transition-planner';
import { createLogger } from '@/lib/logger';

const log = createLogger('CanvasTransitions');

/**
 * Canvas settings for transition rendering
 */
export interface TransitionCanvasSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Active transition with calculated progress
 */
export interface ActiveTransition {
  transition: Transition;
  leftClip: TimelineItem;
  rightClip: TimelineItem;
  progress: number; // 0 to 1
  transitionStart: number;
  transitionEnd: number;
  durationInFrames: number;
  leftPortion: number;
  rightPortion: number;
  cutPoint: number;
}

/**
 * Build a map of clip IDs to clips for quick lookup.
 */
export function buildClipMap(
  clips: TimelineItem[]
): Map<string, TimelineItem> {
  const map = new Map<string, TimelineItem>();
  for (const clip of clips) {
    map.set(clip.id, clip);
  }
  return map;
}

/**
 * Find active transitions at the current frame.
 *
 * @param transitions - All transitions
 * @param clipMap - Map of clip ID to clip
 * @param frame - Current frame
 * @param fps - Frames per second
 * @returns Array of active transitions with progress
 */
export function findActiveTransitions(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>,
  frame: number,
  fps: number
): ActiveTransition[] {
  const active: ActiveTransition[] = [];

  const resolvedWindows = resolveTransitionWindows(transitions, clipMap);
  for (const window of resolvedWindows) {
    if (frame < window.startFrame || frame >= window.endFrame) continue;

    const localFrame = frame - window.startFrame;
    const progress = calculateProgress(
      localFrame,
      window.durationInFrames,
      window.transition.timing,
      fps,
      window.transition.bezierPoints
    );

    active.push({
      transition: window.transition,
      leftClip: window.leftClip,
      rightClip: window.rightClip,
      progress,
      transitionStart: window.startFrame,
      transitionEnd: window.endFrame,
      durationInFrames: window.durationInFrames,
      leftPortion: window.leftPortion,
      rightPortion: window.rightPortion,
      cutPoint: window.cutPoint,
    });
  }

  return active;
}

/**
 * Calculate transition progress with timing.
 *
 * @param localFrame - Frame within transition (0 to duration-1)
 * @param duration - Total transition duration in frames
 * @param timing - Timing type ('linear' or 'spring')
 * @param fps - Frames per second
 * @returns Progress value (0 to 1, may overshoot for spring)
 */
function calculateProgress(
  localFrame: number,
  duration: number,
  timing: string,
  _fps: number,
  bezierPoints?: { x1: number; y1: number; x2: number; y2: number }
): number {
  // Linear progress
  const maxFrame = Math.max(1, duration - 1);
  const linearProgress = Math.max(0, Math.min(1, localFrame / maxFrame));

  switch (timing) {
    case 'spring':
      return springEasing(linearProgress, { tension: 180, friction: 12, mass: 1 });
    case 'ease-in':
      return easeIn(linearProgress);
    case 'ease-out':
      return easeOut(linearProgress);
    case 'ease-in-out':
      return easeInOut(linearProgress);
    case 'cubic-bezier':
      if (bezierPoints) {
        return cubicBezier(linearProgress, bezierPoints);
      }
      return linearProgress;
    default:
      return linearProgress;
  }
}

// ============================================================================
// Transition Presentation Renderers
// ============================================================================

/**
 * Calculate opacity for fade transition using equal-power crossfade.
 */
function getFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos(progress * Math.PI / 2);
  } else {
    return Math.sin(progress * Math.PI / 2);
  }
}

/**
 * Render fade transition.
 */
function renderFadeTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number
): void {
  // Clamp progress for opacity
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Draw incoming clip (right) first
  ctx.save();
  ctx.globalAlpha = getFadeOpacity(clampedProgress, false);
  ctx.drawImage(rightCanvas, 0, 0);
  ctx.restore();

  // Draw outgoing clip (left) on top
  ctx.save();
  ctx.globalAlpha = getFadeOpacity(clampedProgress, true);
  ctx.drawImage(leftCanvas, 0, 0);
  ctx.restore();
}

/**
 * Get clip path for wipe transition.
 */
function getWipeClipPath(
  progress: number,
  direction: WipeDirection,
  isOutgoing: boolean,
  canvas: TransitionCanvasSettings
): Path2D {
  const p = Math.max(0, Math.min(1, progress));
  const path = new Path2D();

  switch (direction) {
    case 'from-left':
      if (isOutgoing) {
        path.rect(p * canvas.width, 0, canvas.width, canvas.height);
      } else {
        path.rect(0, 0, p * canvas.width, canvas.height);
      }
      break;
    case 'from-right':
      if (isOutgoing) {
        path.rect(0, 0, (1 - p) * canvas.width, canvas.height);
      } else {
        path.rect((1 - p) * canvas.width, 0, canvas.width, canvas.height);
      }
      break;
    case 'from-top':
      if (isOutgoing) {
        path.rect(0, p * canvas.height, canvas.width, canvas.height);
      } else {
        path.rect(0, 0, canvas.width, p * canvas.height);
      }
      break;
    case 'from-bottom':
      if (isOutgoing) {
        path.rect(0, 0, canvas.width, (1 - p) * canvas.height);
      } else {
        path.rect(0, (1 - p) * canvas.height, canvas.width, canvas.height);
      }
      break;
  }

  return path;
}

/**
 * Render wipe transition.
 */
function renderWipeTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  direction: WipeDirection,
  canvas: TransitionCanvasSettings
): void {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Draw incoming clip in revealed region only
  ctx.save();
  const incomingClipPath = getWipeClipPath(clampedProgress, direction, false, canvas);
  ctx.clip(incomingClipPath);
  ctx.drawImage(rightCanvas, 0, 0);
  ctx.restore();

  // Draw outgoing clip in remaining region
  ctx.save();
  const outgoingClipPath = getWipeClipPath(clampedProgress, direction, true, canvas);
  ctx.clip(outgoingClipPath);
  ctx.drawImage(leftCanvas, 0, 0);
  ctx.restore();
}

/**
 * Get slide offset for slide transition.
 */
function getSlideOffset(
  progress: number,
  direction: SlideDirection,
  isOutgoing: boolean,
  canvas: TransitionCanvasSettings
): { x: number; y: number } {
  const slideProgress = isOutgoing ? progress : progress - 1;

  switch (direction) {
    case 'from-left':
      return { x: slideProgress * canvas.width, y: 0 };
    case 'from-right':
      return { x: -slideProgress * canvas.width, y: 0 };
    case 'from-top':
      return { x: 0, y: slideProgress * canvas.height };
    case 'from-bottom':
      return { x: 0, y: -slideProgress * canvas.height };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Render slide transition.
 */
function renderSlideTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  direction: SlideDirection,
  canvas: TransitionCanvasSettings
): void {
  // Incoming clip slides in
  const rightOffset = getSlideOffset(progress, direction, false, canvas);
  ctx.drawImage(rightCanvas, rightOffset.x, rightOffset.y);

  // Outgoing clip slides out
  const leftOffset = getSlideOffset(progress, direction, true, canvas);
  ctx.drawImage(leftCanvas, leftOffset.x, leftOffset.y);
}

/**
 * Render flip transition.
 * This is a 2D approximation of a 3D flip effect.
 */
function renderFlipTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  direction: FlipDirection,
  canvas: TransitionCanvasSettings
): void {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const isHorizontal = direction === 'from-left' || direction === 'from-right';
  // Note: isReverse could be used for direction-aware flip but simplified for now

  // First half: outgoing clip flips away
  // Second half: incoming clip flips in
  const midpoint = 0.5;

  if (clampedProgress < midpoint) {
    // First half - outgoing clip
    const flipProgress = clampedProgress / midpoint; // 0 to 1
    const scale = Math.cos(flipProgress * Math.PI / 2);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    if (isHorizontal) {
      ctx.scale(scale, 1);
    } else {
      ctx.scale(1, scale);
    }

    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  } else {
    // Second half - incoming clip
    const flipProgress = (clampedProgress - midpoint) / midpoint; // 0 to 1
    const scale = Math.sin(flipProgress * Math.PI / 2);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    if (isHorizontal) {
      ctx.scale(scale, 1);
    } else {
      ctx.scale(1, scale);
    }

    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();
  }
}

/**
 * Render clock wipe transition.
 * Creates a sweeping reveal like a clock hand moving clockwise from 12 o'clock.
 *
 * The effect works like a clock hand wiping away the outgoing clip:
 * - At progress=0: outgoing clip fully visible
 * - At progress=1: incoming clip fully visible (outgoing wiped away clockwise)
 */
function renderClockWipeTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas: TransitionCanvasSettings
): void {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  // Use diagonal to ensure coverage of corners
  const radius = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height);

  // In canvas coordinates:
  // - 0 radians = 3 o'clock (right)
  // - -π/2 radians = 12 o'clock (top)
  const startAngle = -Math.PI / 2; // 12 o'clock
  const sweepAngle = clampedProgress * Math.PI * 2;
  const currentAngle = startAngle + sweepAngle;

  // Draw incoming clip (full) first - sits underneath
  ctx.drawImage(rightCanvas, 0, 0);

  // Draw outgoing clip clipped to remaining area (inverse of revealed wedge)
  ctx.save();
  const clipPath = new Path2D();
  clipPath.moveTo(centerX, centerY);
  // Arc from current angle BACK to start (the unrevealed portion)
  clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false);
  clipPath.closePath();
  ctx.clip(clipPath);
  ctx.drawImage(leftCanvas, 0, 0);
  ctx.restore();
}

/**
 * Render iris transition.
 * Creates a circular opening from center, revealing the incoming clip.
 *
 * The effect works like a camera iris opening:
 * - At progress=0: outgoing clip fully visible
 * - At progress=1: incoming clip fully visible
 */
function renderIrisTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas: TransitionCanvasSettings
): void {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Maximum radius to cover corners (diagonal / 2 * 1.2 for safety margin)
  const maxRadius = Math.sqrt(
    Math.pow(canvas.width / 2, 2) + Math.pow(canvas.height / 2, 2)
  ) * 1.2;

  const radius = clampedProgress * maxRadius;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Draw incoming clip (full) first - sits underneath
  ctx.drawImage(rightCanvas, 0, 0);

  // Draw outgoing clip with inverse circle clip (donut shape - outside the iris)
  ctx.save();
  const clipPath = new Path2D();
  // Full canvas rect
  clipPath.rect(0, 0, canvas.width, canvas.height);
  // Cut out the circle (evenodd will invert)
  clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip(clipPath, 'evenodd');
  ctx.drawImage(leftCanvas, 0, 0);
  ctx.restore();
}

/**
 * Render hard cut (no transition effect).
 */
function renderCutTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number
): void {
  // Hard cut at midpoint
  if (progress < 0.5) {
    ctx.drawImage(leftCanvas, 0, 0);
  } else {
    ctx.drawImage(rightCanvas, 0, 0);
  }
}

// ============================================================================
// Main Transition Renderer
// ============================================================================

/**
 * Render a transition between two clips.
 *
 * @param ctx - Canvas context for output
 * @param activeTransition - Active transition with clips and progress
 * @param leftCanvas - Pre-rendered left (outgoing) clip content
 * @param rightCanvas - Pre-rendered right (incoming) clip content
 * @param canvas - Canvas settings
 */
export function renderTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  activeTransition: ActiveTransition,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  canvas: TransitionCanvasSettings
): void {
  const { transition, progress } = activeTransition;
  const presentation = transition.presentation;
  const direction = transition.direction;

  log.debug('Rendering transition', {
    presentation,
    direction,
    progress,
    duration: transition.durationInFrames,
  });

  // Try registry renderer first
  const renderer = transitionRegistry.getRenderer(presentation);
  if (renderer?.renderCanvas) {
    renderer.renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas);
    return;
  }

  // Built-in fallback
  switch (presentation) {
    case 'fade':
      renderFadeTransition(ctx, leftCanvas, rightCanvas, progress);
      break;

    case 'wipe':
      renderWipeTransition(
        ctx,
        leftCanvas,
        rightCanvas,
        progress,
        (direction as WipeDirection) || 'from-left',
        canvas
      );
      break;

    case 'slide':
      renderSlideTransition(
        ctx,
        leftCanvas,
        rightCanvas,
        progress,
        (direction as SlideDirection) || 'from-left',
        canvas
      );
      break;

    case 'flip':
      renderFlipTransition(
        ctx,
        leftCanvas,
        rightCanvas,
        progress,
        (direction as FlipDirection) || 'from-left',
        canvas
      );
      break;

    case 'clockWipe':
      renderClockWipeTransition(ctx, leftCanvas, rightCanvas, progress, canvas);
      break;

    case 'iris':
      renderIrisTransition(ctx, leftCanvas, rightCanvas, progress, canvas);
      break;

    case 'none':
    default:
      renderCutTransition(ctx, leftCanvas, rightCanvas, progress);
      break;
  }
}

/**
 * Get clip IDs involved in transitions at the current frame.
 * These clips should be rendered via the transition system, not normally.
 */
export function getTransitionClipIds(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>,
  frame: number
): Set<string> {
  const clipIds = new Set<string>();

  const resolvedWindows = resolveTransitionWindows(transitions, clipMap);
  for (const window of resolvedWindows) {
    if (frame >= window.startFrame && frame < window.endFrame) {
      clipIds.add(window.transition.leftClipId);
      clipIds.add(window.transition.rightClipId);
    }
  }

  return clipIds;
}
