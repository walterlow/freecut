/**
 * GPU Transition Renderers
 *
 * Registers WebGPU-accelerated transitions into the transition registry.
 * Each GPU transition provides:
 * - calculateStyles: CSS approximation for DOM preview
 * - renderCanvas: Canvas 2D fallback for non-GPU environments
 * - gpuTransitionId: ID for GPU-accelerated rendering via TransitionPipeline
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, WipeDirection } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fadeOpacity(progress: number, isOutgoing: boolean): number {
  return isOutgoing
    ? Math.cos((progress * Math.PI) / 2)
    : Math.sin((progress * Math.PI) / 2);
}

// ============================================================================
// Dissolve
// ============================================================================

const dissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'dissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: equal-power crossfade (GPU version uses noise pattern)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: simple crossfade
    const p = clamp01(progress);
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const dissolveDef: TransitionDefinition = {
  id: 'dissolve',
  label: 'Dissolve',
  description: 'Noise-based organic dissolve between clips',
  category: 'basic',
  icon: 'Sparkles',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Glitch
// ============================================================================

const glitchRenderer: TransitionRenderer = {
  gpuTransitionId: 'glitch',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: hard cut with deterministic jitter
    const p = clamp01(progress);
    const envelope = Math.sin(p * Math.PI);
    const offset = Math.sin(p * 47) * envelope * 5;
    const midpoint = 0.5;

    if (isOutgoing) {
      return {
        opacity: p < midpoint ? 1 : 0,
        transform: envelope > 0.2 ? `translateX(${offset}px)` : undefined,
      };
    }
    return {
      opacity: p >= midpoint ? 1 : 0,
      transform: envelope > 0.2 ? `translateX(${-offset}px)` : undefined,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: simple hard cut
    const p = clamp01(progress);
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0);
    } else {
      ctx.drawImage(rightCanvas, 0, 0);
    }
  },
};

const glitchDef: TransitionDefinition = {
  id: 'glitch',
  label: 'Glitch',
  description: 'Digital glitch with RGB split and block displacement',
  category: 'custom',
  icon: 'Zap',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 5,
  maxDuration: 60,
};

// ============================================================================
// Light Leak
// ============================================================================

const lightLeakRenderer: TransitionRenderer = {
  gpuTransitionId: 'lightLeak',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade (GPU version adds warm light sweep)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    // Canvas 2D fallback: directional crossfade
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const dir = (direction as WipeDirection) || 'from-left';

    // Draw incoming
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    // Draw outgoing
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();

    // Add warm glow overlay
    const envelope = Math.sin(p * Math.PI);
    if (envelope > 0.1) {
      ctx.save();
      let gx: number, gy: number;
      switch (dir) {
        case 'from-left': gx = p * w; gy = h / 2; break;
        case 'from-right': gx = (1 - p) * w; gy = h / 2; break;
        case 'from-top': gx = w / 2; gy = p * h; break;
        case 'from-bottom': gx = w / 2; gy = (1 - p) * h; break;
        default: gx = p * w; gy = h / 2;
      }
      const radius = Math.max(w, h) * 0.4;
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
      gradient.addColorStop(0, `rgba(255, 230, 180, ${0.3 * envelope})`);
      gradient.addColorStop(1, 'rgba(255, 230, 180, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  },
};

const lightLeakDef: TransitionDefinition = {
  id: 'lightLeak',
  label: 'Light Leak',
  description: 'Warm light sweep revealing the next clip',
  category: 'light',
  icon: 'Sun',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Pixelate
// ============================================================================

const pixelateRenderer: TransitionRenderer = {
  gpuTransitionId: 'pixelate',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade (GPU version does mosaic pixelation)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: hard cut at midpoint
    const p = clamp01(progress);
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0);
    } else {
      ctx.drawImage(rightCanvas, 0, 0);
    }
  },
};

const pixelateDef: TransitionDefinition = {
  id: 'pixelate',
  label: 'Pixelate',
  description: 'Mosaic pixelation dissolve between clips',
  category: 'custom',
  icon: 'Grid3x3',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 8,
  maxDuration: 60,
};

// ============================================================================
// Chromatic
// ============================================================================

const chromaticRenderer: TransitionRenderer = {
  gpuTransitionId: 'chromatic',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight blur
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    // Canvas 2D fallback: directional crossfade
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();
  },
};

const chromaticDef: TransitionDefinition = {
  id: 'chromatic',
  label: 'Chromatic',
  description: 'RGB channel split with directional sweep',
  category: 'chromatic',
  icon: 'Aperture',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Radial Blur
// ============================================================================

const radialBlurRenderer: TransitionRenderer = {
  gpuTransitionId: 'radialBlur',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight scale
    const p = clamp01(progress);
    const envelope = Math.sin(p * Math.PI);
    const scale = 1 + envelope * 0.02;
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform: envelope > 0.1 ? `scale(${scale})` : undefined,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: crossfade
    const p = clamp01(progress);
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const radialBlurDef: TransitionDefinition = {
  id: 'radialBlur',
  label: 'Radial Blur',
  description: 'Zoom and spin blur transition',
  category: 'custom',
  icon: 'CircleDot',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Registration
// ============================================================================

export function registerGpuTransitions(registry: TransitionRegistry): void {
  registry.register('dissolve', dissolveDef, dissolveRenderer);
  registry.register('glitch', glitchDef, glitchRenderer);
  registry.register('lightLeak', lightLeakDef, lightLeakRenderer);
  registry.register('pixelate', pixelateDef, pixelateRenderer);
  registry.register('chromatic', chromaticDef, chromaticRenderer);
  registry.register('radialBlur', radialBlurDef, radialBlurRenderer);
}
