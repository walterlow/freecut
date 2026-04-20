/**
 * Mask Transition Renderers
 *
 * Includes: clockWipe, iris
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getNumericProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
  fallback: number
): number {
  const raw = properties?.[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  return raw;
}

function getIrisMaxRadius(width: number, height: number): number {
  return Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)) * 1.2;
}

function getEndpointSafeSoftness(edgeSoftness: number, distanceFromStart: number, distanceToEnd: number): number {
  return Math.max(0, Math.min(edgeSoftness, distanceFromStart, distanceToEnd));
}

export function getClockWipeMaskState(progress: number, edgeSoftness: number): {
  degrees: number;
  effectiveEdgeSoftness: number;
} {
  const degrees = clamp01(progress) * 360;
  return {
    degrees,
    effectiveEdgeSoftness: getEndpointSafeSoftness(edgeSoftness, degrees, 360 - degrees),
  };
}

export function getIrisMaskState(
  progress: number,
  width: number,
  height: number,
  edgeSoftness: number
): {
  maxRadius: number;
  radius: number;
  effectiveEdgeSoftness: number;
} {
  const maxRadius = getIrisMaxRadius(width, height);
  const radius = clamp01(progress) * maxRadius;
  return {
    maxRadius,
    radius,
    effectiveEdgeSoftness: getEndpointSafeSoftness(edgeSoftness, radius, maxRadius - radius),
  };
}


// ============================================================================
// Clock Wipe
// ============================================================================

// The CSS preview mirrors mask geometry and opacity only. The production WebGPU
// shaders also apply a subtle UV zoom envelope that is intentionally shader-only.
const clockWipeRenderer: TransitionRenderer = {
  gpuTransitionId: 'clockWipe',
  calculateStyles(progress, isOutgoing, _cw, _ch, _dir, properties): TransitionStyleCalculation {
    const p = clamp01(progress);
    const edgeSoftness = Math.max(0, getNumericProperty(properties, 'edgeSoftness', 8));

    if (isOutgoing) {
      if (p <= 0) {
        return { opacity: 1 };
      }
      if (p >= 1) {
        return { opacity: 0 };
      }

      const { degrees, effectiveEdgeSoftness } = getClockWipeMaskState(p, edgeSoftness);
      const featherStart = Math.max(0, degrees - effectiveEdgeSoftness);
      const featherEnd = Math.min(360, degrees + effectiveEdgeSoftness);
      const maskImage = `conic-gradient(from -90deg, transparent ${featherStart}deg, rgba(0,0,0,0.8) ${degrees}deg, black ${featherEnd}deg)`;
      return {
        maskImage,
        webkitMaskImage: maskImage,
        maskSize: '100% 100%',
        webkitMaskSize: '100% 100%',
        opacity: 1 - (0.1 * p),
      };
    }

    return {
      opacity: 0.85 + (0.15 * p),
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.sqrt(w * w + h * h);
    const startAngle = -Math.PI / 2;
    const sweepAngle = p * Math.PI * 2;
    const currentAngle = startAngle + sweepAngle;

    ctx.save();
    ctx.globalAlpha = 0.85 + (0.15 * p);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    const clipPath = new Path2D();
    clipPath.moveTo(centerX, centerY);
    clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false);
    clipPath.closePath();
    ctx.clip(clipPath);
    ctx.globalAlpha = 1 - (0.1 * p);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();
  },
};

const clockWipeDef: TransitionDefinition = {
  id: 'clockWipe',
  label: 'Clock Wipe',
  description: 'Circular wipe like a clock hand',
  category: 'mask',
  icon: 'Clock',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Iris
// ============================================================================

const irisRenderer: TransitionRenderer = {
  gpuTransitionId: 'iris',
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, _dir, properties): TransitionStyleCalculation {
    const p = clamp01(progress);
    const edgeSoftness = Math.max(0, getNumericProperty(properties, 'edgeSoftness', 6));

    if (isOutgoing) {
      if (p <= 0) {
        return { opacity: 1 };
      }
      if (p >= 1) {
        return { opacity: 0 };
      }

      const { radius, effectiveEdgeSoftness } = getIrisMaskState(p, canvasWidth, canvasHeight, edgeSoftness);
      const inner = Math.max(0, radius - effectiveEdgeSoftness);
      const outer = radius + effectiveEdgeSoftness;
      const maskImage = `radial-gradient(circle at center, transparent ${inner}px, rgba(0,0,0,0.85) ${radius}px, black ${outer}px)`;
      return {
        maskImage,
        webkitMaskImage: maskImage,
        maskSize: '100% 100%',
        webkitMaskSize: '100% 100%',
        opacity: 1 - (0.1 * p),
      };
    }

    return {
      opacity: 0.85 + (0.15 * p),
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const maxRadius = getIrisMaxRadius(w, h);
    const radius = p * maxRadius;
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.save();
    ctx.globalAlpha = 0.85 + (0.15 * p);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    const clipPath = new Path2D();
    clipPath.rect(0, 0, w, h);
    clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip(clipPath, 'evenodd');
    ctx.globalAlpha = 1 - (0.1 * p);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();
  },
};

const irisDef: TransitionDefinition = {
  id: 'iris',
  label: 'Iris',
  description: 'Circular iris expanding/contracting',
  category: 'mask',
  icon: 'Circle',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Registration
// ============================================================================

export function registerMaskTransitions(registry: TransitionRegistry): void {
  registry.register('clockWipe', clockWipeDef, clockWipeRenderer);
  registry.register('iris', irisDef, irisRenderer);
}
