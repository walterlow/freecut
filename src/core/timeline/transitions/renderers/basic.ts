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
  // cos²/sin² weights — always sum to 1, preserving alpha for soft crop & masks.
  const c = Math.cos((progress * Math.PI) / 2);
  if (isOutgoing) {
    return c * c;
  }
  return 1 - c * c;
}

const fadeRenderer: TransitionRenderer = {
  gpuTransitionId: 'fade',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress);
    return {
      opacity: calculateFadeOpacity(p, isOutgoing),
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = clamp01(progress);
    const outgoingWeight = calculateFadeOpacity(p, true);
    const incomingWeight = calculateFadeOpacity(p, false);

    // Soft crop/masks introduce real alpha, so fade needs to weight both
    // participants instead of treating the incoming clip as a fully opaque bed.
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = incomingWeight;
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = outgoingWeight;
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
