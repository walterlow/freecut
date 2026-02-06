/**
 * Slide Transition Renderers
 *
 * Includes: slide, push, cover, swap
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, SlideDirection } from '@/types/transition';

const ALL_DIRECTIONS: SlideDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom'];
const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

function getSlideOffset(
  progress: number,
  direction: SlideDirection,
  isOutgoing: boolean,
  w: number,
  h: number
): { x: number; y: number } {
  const p = isOutgoing ? progress : progress - 1;
  switch (direction) {
    case 'from-left': return { x: p * w, y: 0 };
    case 'from-right': return { x: -p * w, y: 0 };
    case 'from-top': return { x: 0, y: p * h };
    case 'from-bottom': return { x: 0, y: -p * h };
    default: return { x: 0, y: 0 };
  }
}

// ============================================================================
// Slide
// ============================================================================

const slideRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const dir = (direction as SlideDirection) || 'from-left';
    const slideProgress = isOutgoing ? progress : progress - 1;
    let transform: string;
    switch (dir) {
      case 'from-left': transform = `translateX(${slideProgress * canvasWidth}px)`; break;
      case 'from-right': transform = `translateX(${-slideProgress * canvasWidth}px)`; break;
      case 'from-top': transform = `translateY(${slideProgress * canvasHeight}px)`; break;
      case 'from-bottom': transform = `translateY(${-slideProgress * canvasHeight}px)`; break;
      default: transform = 'none';
    }
    return { transform };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const dir = (direction as SlideDirection) || 'from-left';
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const rightOff = getSlideOffset(progress, dir, false, w, h);
    ctx.drawImage(rightCanvas, rightOff.x, rightOff.y);
    const leftOff = getSlideOffset(progress, dir, true, w, h);
    ctx.drawImage(leftCanvas, leftOff.x, leftOff.y);
  },
};

const slideDef: TransitionDefinition = {
  id: 'slide',
  label: 'Slide',
  description: 'Slide in from a direction',
  category: 'slide',
  icon: 'MoveRight',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Push (old clip pushed out by new clip)
// ============================================================================

const pushRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    // Both clips move: outgoing is pushed out, incoming pushes in
    let transform: string;
    if (isOutgoing) {
      switch (dir) {
        case 'from-left': transform = `translateX(${p * canvasWidth}px)`; break;
        case 'from-right': transform = `translateX(${-p * canvasWidth}px)`; break;
        case 'from-top': transform = `translateY(${p * canvasHeight}px)`; break;
        case 'from-bottom': transform = `translateY(${-p * canvasHeight}px)`; break;
        default: transform = 'none';
      }
    } else {
      switch (dir) {
        case 'from-left': transform = `translateX(${(p - 1) * canvasWidth}px)`; break;
        case 'from-right': transform = `translateX(${(1 - p) * canvasWidth}px)`; break;
        case 'from-top': transform = `translateY(${(p - 1) * canvasHeight}px)`; break;
        case 'from-bottom': transform = `translateY(${(1 - p) * canvasHeight}px)`; break;
        default: transform = 'none';
      }
    }
    return { transform };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    let outX = 0, outY = 0, inX = 0, inY = 0;
    switch (dir) {
      case 'from-left': outX = p * w; inX = (p - 1) * w; break;
      case 'from-right': outX = -p * w; inX = (1 - p) * w; break;
      case 'from-top': outY = p * h; inY = (p - 1) * h; break;
      case 'from-bottom': outY = -p * h; inY = (1 - p) * h; break;
    }
    ctx.drawImage(rightCanvas, inX, inY);
    ctx.drawImage(leftCanvas, outX, outY);
  },
};

const pushDef: TransitionDefinition = {
  id: 'push',
  label: 'Push',
  description: 'Push old clip out with new clip',
  category: 'slide',
  icon: 'ArrowRightFromLine',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Cover (new clip slides over old clip)
// ============================================================================

const coverRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Outgoing stays still
      return {};
    }
    // Incoming slides in over the top
    let transform: string;
    switch (dir) {
      case 'from-left': transform = `translateX(${(p - 1) * canvasWidth}px)`; break;
      case 'from-right': transform = `translateX(${(1 - p) * canvasWidth}px)`; break;
      case 'from-top': transform = `translateY(${(p - 1) * canvasHeight}px)`; break;
      case 'from-bottom': transform = `translateY(${(1 - p) * canvasHeight}px)`; break;
      default: transform = 'none';
    }
    return { transform };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    // Draw outgoing first (underneath)
    ctx.drawImage(leftCanvas, 0, 0);
    // Incoming slides over
    let inX = 0, inY = 0;
    switch (dir) {
      case 'from-left': inX = (p - 1) * w; break;
      case 'from-right': inX = (1 - p) * w; break;
      case 'from-top': inY = (p - 1) * h; break;
      case 'from-bottom': inY = (1 - p) * h; break;
    }
    ctx.drawImage(rightCanvas, inX, inY);
  },
};

const coverDef: TransitionDefinition = {
  id: 'cover',
  label: 'Cover',
  description: 'New clip covers old clip',
  category: 'slide',
  icon: 'Layers',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Swap (both clips slide in opposite directions)
// ============================================================================

const swapRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    let transform: string;
    if (isOutgoing) {
      // Outgoing slides out in the opposite direction
      switch (dir) {
        case 'from-left': transform = `translateX(${-p * canvasWidth}px)`; break;
        case 'from-right': transform = `translateX(${p * canvasWidth}px)`; break;
        case 'from-top': transform = `translateY(${-p * canvasHeight}px)`; break;
        case 'from-bottom': transform = `translateY(${p * canvasHeight}px)`; break;
        default: transform = 'none';
      }
    } else {
      switch (dir) {
        case 'from-left': transform = `translateX(${(1 - p) * canvasWidth}px)`; break;
        case 'from-right': transform = `translateX(${-(1 - p) * canvasWidth}px)`; break;
        case 'from-top': transform = `translateY(${(1 - p) * canvasHeight}px)`; break;
        case 'from-bottom': transform = `translateY(${-(1 - p) * canvasHeight}px)`; break;
        default: transform = 'none';
      }
    }
    return { transform };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const dir = (direction as SlideDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    let outX = 0, outY = 0, inX = 0, inY = 0;
    switch (dir) {
      case 'from-left': outX = -p * w; inX = (1 - p) * w; break;
      case 'from-right': outX = p * w; inX = -(1 - p) * w; break;
      case 'from-top': outY = -p * h; inY = (1 - p) * h; break;
      case 'from-bottom': outY = p * h; inY = -(1 - p) * h; break;
    }
    ctx.drawImage(leftCanvas, outX, outY);
    ctx.drawImage(rightCanvas, inX, inY);
  },
};

const swapDef: TransitionDefinition = {
  id: 'swap',
  label: 'Swap',
  description: 'Both clips slide in opposite directions',
  category: 'slide',
  icon: 'ArrowLeftRight',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Registration
// ============================================================================

export function registerSlideTransitions(registry: TransitionRegistry): void {
  registry.register('slide', slideDef, slideRenderer);
  registry.register('push', pushDef, pushRenderer);
  registry.register('cover', coverDef, coverRenderer);
  registry.register('swap', swapDef, swapRenderer);
}
