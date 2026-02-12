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

function calculateFadeScale(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    // A small zoom-out reinforces that the outgoing clip is leaving.
    return 1 - (0.04 * progress);
  }
  // Incoming clip starts slightly larger and settles to 1.
  return 1.04 - (0.04 * progress);
}

function drawScaledCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: OffscreenCanvas,
  scale: number
): void {
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

const fadeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress);
    const scale = calculateFadeScale(p, isOutgoing);
    return {
      opacity: calculateFadeOpacity(p, isOutgoing),
      transform: `scale(${scale})`,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = clamp01(progress);

    // Draw incoming clip (right) first.
    ctx.save();
    ctx.globalAlpha = calculateFadeOpacity(p, false);
    drawScaledCanvas(ctx, rightCanvas, calculateFadeScale(p, false));
    ctx.restore();

    // Draw outgoing clip (left) on top.
    ctx.save();
    ctx.globalAlpha = calculateFadeOpacity(p, true);
    drawScaledCanvas(ctx, leftCanvas, calculateFadeScale(p, true));
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
