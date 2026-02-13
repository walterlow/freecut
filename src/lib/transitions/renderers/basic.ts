/**
 * Basic Transition Renderers
 *
 * Includes: fade
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

// ============================================================================
// Fade
// ============================================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function calculateFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos((progress * Math.PI) / 2);
  }
  return Math.sin((progress * Math.PI) / 2);
}

const fadeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress);
    return {
      opacity: calculateFadeOpacity(p, isOutgoing),
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = clamp01(progress);

    // Draw incoming clip (right) first.
    ctx.save();
    ctx.globalAlpha = calculateFadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    // Draw outgoing clip (left) on top.
    ctx.save();
    ctx.globalAlpha = calculateFadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const fadeDef: TransitionDefinition = {
  id: 'fade',
  label: 'Fade',
  description: 'Simple crossfade between clips',
  category: 'basic',
  icon: 'Blend',
  hasDirection: false,
  supportedTimings: ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Registration
// ============================================================================

export function registerBasicTransitions(registry: TransitionRegistry): void {
  registry.register('fade', fadeDef, fadeRenderer);
}
