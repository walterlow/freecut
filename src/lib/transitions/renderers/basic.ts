/**
 * Basic Transition Renderers
 *
 * Includes: fade, none (cut), dissolve, additive-dissolve
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

// ============================================================================
// Fade
// ============================================================================

function calculateFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos((progress * Math.PI) / 2);
  }
  return Math.sin((progress * Math.PI) / 2);
}

const fadeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    return { opacity: calculateFadeOpacity(p, isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = Math.max(0, Math.min(1, progress));
    ctx.save();
    ctx.globalAlpha = calculateFadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();
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
// None (Cut)
// ============================================================================

const noneRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const midpoint = 0.5;
    return {
      opacity: isOutgoing
        ? progress < midpoint ? 1 : 0
        : progress >= midpoint ? 1 : 0,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    if (progress < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0);
    } else {
      ctx.drawImage(rightCanvas, 0, 0);
    }
  },
};

const noneDef: TransitionDefinition = {
  id: 'none',
  label: 'Cut',
  description: 'Instant cut with no effect',
  category: 'basic',
  icon: 'Scissors',
  hasDirection: false,
  supportedTimings: ['linear'],
  defaultDuration: 30,
  minDuration: 2,
  maxDuration: 90,
};

// ============================================================================
// Dissolve (gamma-aware blend)
// ============================================================================

const dissolveRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    // Gamma-aware: apply gamma 2.2 correction for perceptually linear blend
    const gamma = 2.2;
    if (isOutgoing) {
      return { opacity: Math.pow(1 - p, 1 / gamma) };
    }
    return { opacity: Math.pow(p, 1 / gamma) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = Math.max(0, Math.min(1, progress));
    const gamma = 2.2;
    ctx.save();
    ctx.globalAlpha = Math.pow(p, 1 / gamma);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = Math.pow(1 - p, 1 / gamma);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const dissolveDef: TransitionDefinition = {
  id: 'dissolve',
  label: 'Dissolve',
  description: 'Film dissolve with gamma-aware blending',
  category: 'basic',
  icon: 'Sparkles',
  hasDirection: false,
  supportedTimings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'],
  defaultDuration: 45,
  minDuration: 10,
  maxDuration: 120,
};

// ============================================================================
// Additive Dissolve
// ============================================================================

const additiveDissolveRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    // Additive: both clips briefly exceed full opacity for a bright flash
    if (isOutgoing) {
      const opacity = p < 0.5 ? 1.0 : Math.max(0, 1 - (p - 0.5) * 2);
      return { opacity };
    }
    const opacity = p < 0.5 ? p * 2 : 1.0;
    return { opacity };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = Math.max(0, Math.min(1, progress));
    // Use lighter composite for additive blending
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const outAlpha = p < 0.5 ? 1.0 : Math.max(0, 1 - (p - 0.5) * 2);
    const inAlpha = p < 0.5 ? p * 2 : 1.0;
    ctx.globalAlpha = inAlpha;
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.globalAlpha = outAlpha;
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const additiveDissolve: TransitionDefinition = {
  id: 'additive-dissolve',
  label: 'Additive Dissolve',
  description: 'Bright additive blend dissolve',
  category: 'basic',
  icon: 'Sun',
  hasDirection: false,
  supportedTimings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Registration
// ============================================================================

export function registerBasicTransitions(registry: TransitionRegistry): void {
  registry.register('fade', fadeDef, fadeRenderer);
  registry.register('none', noneDef, noneRenderer);
  registry.register('dissolve', dissolveDef, dissolveRenderer);
  registry.register('additive-dissolve', additiveDissolve, additiveDissolveRenderer);
}
