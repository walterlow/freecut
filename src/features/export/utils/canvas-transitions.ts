/**
 * Canvas Transition Rendering System
 *
 * Renders visual transitions between adjacent clips for client-side export.
 * Supports all presentation types: fade, wipe, slide, flip, clockWipe, iris.
 */

import type { Transition, WipeDirection, SlideDirection, FlipDirection } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';
import { springEasing, easeIn, easeOut, easeInOut, cubicBezier } from '@/domain/animation/easing';
import { transitionRegistry } from '@/domain/timeline/transitions/registry';
import { resolveTransitionWindows } from '@/domain/timeline/transitions/transition-planner';
import { createLogger } from '@/shared/logging/logger';

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
 * Pre-resolved transition windows for fast per-frame lookups.
 * Build once per render, then reuse for every frame.
 */
export interface TransitionFrameIndex {
  windows: ReturnType<typeof resolveTransitionWindows>;
}

/**
 * Transition data needed for one frame.
 */
export interface TransitionFrameState {
  activeTransitions: ActiveTransition[];
  transitionClipIds: Set<string>;
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
 * Build an index of resolved transition windows once before rendering.
 */
export function createTransitionFrameIndex(
  transitions: Transition[],
  clipMap: Map<string, TimelineItem>
): TransitionFrameIndex {
  return {
    windows: resolveTransitionWindows(transitions, clipMap),
  };
}

/**
 * Resolve active transitions and participating clip IDs for one frame.
 * Uses pre-resolved windows to avoid expensive recomputation per frame.
 */
export function getTransitionFrameState(
  index: TransitionFrameIndex,
  frame: number,
  fps: number
): TransitionFrameState {
  const activeTransitions: ActiveTransition[] = [];
  const transitionClipIds = new Set<string>();

  for (const window of index.windows) {
    if (frame < window.startFrame || frame >= window.endFrame) continue;

    const localFrame = frame - window.startFrame;
    const progress = calculateProgress(
      localFrame,
      window.durationInFrames,
      window.transition.timing,
      fps,
      window.transition.bezierPoints
    );

    activeTransitions.push({
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

    transitionClipIds.add(window.transition.leftClipId);
    transitionClipIds.add(window.transition.rightClipId);
  }

  return { activeTransitions, transitionClipIds };
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
  const index = createTransitionFrameIndex(transitions, clipMap);
  return getTransitionFrameState(index, frame, fps).activeTransitions;
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
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos(progress * Math.PI / 2);
  }
  return Math.sin(progress * Math.PI / 2);
}

function getFadeScale(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return 1 - (0.04 * progress);
  }
  return 1.04 - (0.04 * progress);
}

function drawScaledCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  canvas: TransitionCanvasSettings,
  scale: number,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

/**
 * Render fade transition.
 */
function renderFadeTransition(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas: TransitionCanvasSettings
): void {
  const p = clamp01(progress);

  drawScaledCanvas(
    ctx,
    rightCanvas,
    canvas,
    getFadeScale(p, false),
    getFadeOpacity(p, false)
  );

  drawScaledCanvas(
    ctx,
    leftCanvas,
    canvas,
    getFadeScale(p, true),
    getFadeOpacity(p, true)
  );
}

function getWipeDirectionVector(direction: WipeDirection): { x: number; y: number } {
  switch (direction) {
    case 'from-left':
      return { x: 1, y: 0 };
    case 'from-right':
      return { x: -1, y: 0 };
    case 'from-top':
      return { x: 0, y: 1 };
    case 'from-bottom':
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 0 };
  }
}

function getWipeOffset(
  progress: number,
  direction: WipeDirection,
  isOutgoing: boolean,
  canvas: TransitionCanvasSettings
): { x: number; y: number } {
  const p = clamp01(progress);
  const vec = getWipeDirectionVector(direction);
  const travel = isOutgoing ? 0.035 : 0.025;
  const phase = isOutgoing ? p : p - 1;

  return {
    x: vec.x * phase * canvas.width * travel,
    y: vec.y * phase * canvas.height * travel,
  };
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
  const p = clamp01(progress);
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
  const p = clamp01(progress);

  const incomingOffset = getWipeOffset(p, direction, false, canvas);
  ctx.save();
  const incomingClipPath = getWipeClipPath(p, direction, false, canvas);
  ctx.clip(incomingClipPath);
  ctx.globalAlpha = 1;
  ctx.drawImage(rightCanvas, incomingOffset.x, incomingOffset.y);
  ctx.restore();

  const outgoingOffset = getWipeOffset(p, direction, true, canvas);
  ctx.save();
  const outgoingClipPath = getWipeClipPath(p, direction, true, canvas);
  ctx.clip(outgoingClipPath);
  ctx.globalAlpha = 1;
  ctx.drawImage(leftCanvas, outgoingOffset.x, outgoingOffset.y);
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
  const p = clamp01(progress);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height);

  const startAngle = -Math.PI / 2;
  const sweepAngle = p * Math.PI * 2;
  const currentAngle = startAngle + sweepAngle;

  drawScaledCanvas(ctx, rightCanvas, canvas, 1.04 - (0.04 * p), 0.85 + (0.15 * p));

  ctx.save();
  const clipPath = new Path2D();
  clipPath.moveTo(centerX, centerY);
  clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false);
  clipPath.closePath();
  ctx.clip(clipPath);
  drawScaledCanvas(ctx, leftCanvas, canvas, 1 - (0.04 * p), 1 - (0.1 * p));
  ctx.restore();
}

function getIrisMaxRadius(width: number, height: number): number {
  return Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)) * 1.2;
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
  const p = clamp01(progress);

  const maxRadius = getIrisMaxRadius(canvas.width, canvas.height);
  const radius = p * maxRadius;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  drawScaledCanvas(ctx, rightCanvas, canvas, 1.04 - (0.04 * p), 0.85 + (0.15 * p));

  ctx.save();
  const clipPath = new Path2D();
  clipPath.rect(0, 0, canvas.width, canvas.height);
  clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip(clipPath, 'evenodd');
  drawScaledCanvas(ctx, leftCanvas, canvas, 1 - (0.04 * p), 1 - (0.1 * p));
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

  if (import.meta.env.DEV) {
    log.debug('Rendering transition', {
      presentation,
      direction,
      progress,
      duration: transition.durationInFrames,
    });
  }

  // Try registry renderer first
  const renderer = transitionRegistry.getRenderer(presentation);
  if (renderer?.renderCanvas) {
    renderer.renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas);
    return;
  }

  // Built-in fallback
  switch (presentation) {
    case 'fade':
      renderFadeTransition(ctx, leftCanvas, rightCanvas, progress, canvas);
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
  const index = createTransitionFrameIndex(transitions, clipMap);
  const clipIds = new Set<string>();
  for (const window of index.windows) {
    if (frame < window.startFrame || frame >= window.endFrame) continue;
    clipIds.add(window.transition.leftClipId);
    clipIds.add(window.transition.rightClipId);
  }
  return clipIds;
}

