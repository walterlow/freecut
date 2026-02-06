/**
 * Distortion Transition Renderers
 *
 * Includes: glitch
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Glitch
// ============================================================================

/** Simple deterministic pseudo-random from seed */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const glitchRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));

    // Glitch intensity peaks at midpoint
    const intensity = p < 0.5 ? p * 2 : (1 - p) * 2;
    const seed = Math.floor(p * 100);

    if (isOutgoing) {
      if (intensity > 0.1) {
        // Random offset and color shift
        const offsetX = (seededRandom(seed) - 0.5) * intensity * 30;
        const offsetY = (seededRandom(seed + 1) - 0.5) * intensity * 10;
        return {
          transform: `translate(${offsetX}px, ${offsetY}px)`,
          opacity: p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2),
        };
      }
      return { opacity: p < 0.5 ? 1 : 0 };
    }

    // Incoming
    if (intensity > 0.1) {
      const offsetX = (seededRandom(seed + 2) - 0.5) * intensity * 30;
      const offsetY = (seededRandom(seed + 3) - 0.5) * intensity * 10;
      return {
        transform: `translate(${offsetX}px, ${offsetY}px)`,
        opacity: p > 0.5 ? 1 : p * 2,
      };
    }
    return { opacity: p > 0.5 ? 1 : 0 };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const intensity = p < 0.5 ? p * 2 : (1 - p) * 2;
    const sliceCount = Math.floor(intensity * 15) + 1;
    const seed = Math.floor(p * 100);

    // Draw base (incoming or outgoing depending on progress)
    const baseCanvas = p < 0.5 ? leftCanvas : rightCanvas;
    ctx.drawImage(baseCanvas, 0, 0);

    // Overlay glitch slices from the other canvas
    const overlayCanvas = p < 0.5 ? rightCanvas : leftCanvas;
    const overlayAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;

    ctx.save();
    ctx.globalAlpha = overlayAlpha;
    for (let i = 0; i < sliceCount; i++) {
      const sliceY = seededRandom(seed + i * 10) * h;
      const sliceH = seededRandom(seed + i * 10 + 1) * h * 0.1;
      const offsetX = (seededRandom(seed + i * 10 + 2) - 0.5) * intensity * w * 0.2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, sliceY, w, sliceH);
      ctx.clip();
      ctx.drawImage(overlayCanvas, offsetX, 0);
      ctx.restore();
    }
    ctx.restore();
  },
};

const glitchDef: TransitionDefinition = {
  id: 'glitch',
  label: 'Glitch',
  description: 'Digital glitch effect',
  category: 'distortion',
  icon: 'Zap',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 5,
  maxDuration: 60,
  requiresWebGL: false,
};

// ============================================================================
// Registration
// ============================================================================

export function registerDistortionTransitions(registry: TransitionRegistry): void {
  registry.register('glitch', glitchDef, glitchRenderer);
}
