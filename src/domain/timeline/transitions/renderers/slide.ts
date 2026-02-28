/**
 * Slide Transition Renderers
 *
 * Includes: slide
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
// Registration
// ============================================================================

export function registerSlideTransitions(registry: TransitionRegistry): void {
  registry.register('slide', slideDef, slideRenderer);
}
