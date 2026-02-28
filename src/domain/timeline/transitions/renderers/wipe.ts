/**
 * Wipe Transition Renderers
 *
 * Includes: wipe
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, WipeDirection } from '@/types/transition';

const ALL_DIRECTIONS: WipeDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom'];
const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Wipe
// ============================================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function calculateWipeClipPath(progress: number, direction: WipeDirection, isOutgoing: boolean): string {
  const p = clamp01(progress);
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

const wipeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, _canvasWidth, _canvasHeight, direction): TransitionStyleCalculation {
    const p = clamp01(progress);
    const dir = (direction as WipeDirection) || 'from-left';
    const clipPath = calculateWipeClipPath(p, dir, isOutgoing);

    return {
      clipPath,
      webkitClipPath: clipPath,
      opacity: 1,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = clamp01(progress);
    const dir = (direction as WipeDirection) || 'from-left';
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    const outgoingPath = new Path2D();
    const incomingPath = new Path2D();
    switch (dir) {
      case 'from-left':
        incomingPath.rect(0, 0, p * w, h);
        outgoingPath.rect(p * w, 0, w, h);
        break;
      case 'from-right':
        incomingPath.rect((1 - p) * w, 0, w, h);
        outgoingPath.rect(0, 0, (1 - p) * w, h);
        break;
      case 'from-top':
        incomingPath.rect(0, 0, w, p * h);
        outgoingPath.rect(0, p * h, w, h);
        break;
      case 'from-bottom':
        incomingPath.rect(0, (1 - p) * h, w, h);
        outgoingPath.rect(0, 0, w, (1 - p) * h);
        break;
    }

    ctx.save();
    ctx.clip(incomingPath);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.clip(outgoingPath);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const wipeDef: TransitionDefinition = {
  id: 'wipe',
  label: 'Wipe',
  description: 'Wipe reveal from one direction',
  category: 'wipe',
  icon: 'ArrowRight',
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

export function registerWipeTransitions(registry: TransitionRegistry): void {
  registry.register('wipe', wipeDef, wipeRenderer);
}
