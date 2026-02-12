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

function drawScaledCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  width: number,
  height: number,
  scale: number
): void {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-width / 2, -height / 2);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

// ============================================================================
// Clock Wipe
// ============================================================================

const clockWipeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, _cw, _ch, _dir, properties): TransitionStyleCalculation {
    const p = clamp01(progress);
    const intensity = Math.max(0.5, Math.min(2, getNumericProperty(properties, 'intensity', 1)));
    const edgeSoftness = Math.max(0, getNumericProperty(properties, 'edgeSoftness', 8));

    if (isOutgoing) {
      const degrees = p * 360;
      const featherStart = Math.max(0, degrees - edgeSoftness);
      const maskImage = `conic-gradient(from -90deg, transparent ${featherStart}deg, rgba(0,0,0,0.8) ${degrees}deg, black ${Math.min(360, degrees + edgeSoftness)}deg)`;
      const scale = 1 - (0.04 * intensity * p);
      return {
        maskImage,
        webkitMaskImage: maskImage,
        maskSize: '100% 100%',
        webkitMaskSize: '100% 100%',
        transform: `scale(${scale})`,
        opacity: 1 - (0.1 * p),
      };
    }

    const incomingScale = 1.04 - (0.04 * intensity * p);
    return {
      opacity: 0.85 + (0.15 * p),
      transform: `scale(${incomingScale})`,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas, properties) {
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const intensity = Math.max(0.5, Math.min(2, getNumericProperty(properties, 'intensity', 1)));
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.sqrt(w * w + h * h);
    const startAngle = -Math.PI / 2;
    const sweepAngle = p * Math.PI * 2;
    const currentAngle = startAngle + sweepAngle;

    ctx.save();
    ctx.globalAlpha = 0.85 + (0.15 * p);
    drawScaledCanvas(ctx, rightCanvas, w, h, 1.04 - (0.04 * intensity * p));
    ctx.restore();

    ctx.save();
    const clipPath = new Path2D();
    clipPath.moveTo(centerX, centerY);
    clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false);
    clipPath.closePath();
    ctx.clip(clipPath);
    ctx.globalAlpha = 1 - (0.1 * p);
    drawScaledCanvas(ctx, leftCanvas, w, h, 1 - (0.04 * intensity * p));
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
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, _dir, properties): TransitionStyleCalculation {
    const p = clamp01(progress);
    const intensity = Math.max(0.5, Math.min(2, getNumericProperty(properties, 'intensity', 1)));
    const edgeSoftness = Math.max(0, getNumericProperty(properties, 'edgeSoftness', 6));

    if (isOutgoing) {
      const maxRadius = getIrisMaxRadius(canvasWidth, canvasHeight);
      const radius = p * maxRadius;
      const inner = Math.max(0, radius - edgeSoftness);
      const outer = radius + edgeSoftness;
      const maskImage = `radial-gradient(circle at center, transparent ${inner}px, rgba(0,0,0,0.85) ${radius}px, black ${outer}px)`;
      return {
        maskImage,
        webkitMaskImage: maskImage,
        maskSize: '100% 100%',
        webkitMaskSize: '100% 100%',
        transform: `scale(${1 - (0.04 * intensity * p)})`,
        opacity: 1 - (0.1 * p),
      };
    }

    return {
      opacity: 0.85 + (0.15 * p),
      transform: `scale(${1.04 - (0.04 * intensity * p)})`,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas, properties) {
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const intensity = Math.max(0.5, Math.min(2, getNumericProperty(properties, 'intensity', 1)));
    const maxRadius = getIrisMaxRadius(w, h);
    const radius = p * maxRadius;
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.save();
    ctx.globalAlpha = 0.85 + (0.15 * p);
    drawScaledCanvas(ctx, rightCanvas, w, h, 1.04 - (0.04 * intensity * p));
    ctx.restore();

    ctx.save();
    const clipPath = new Path2D();
    clipPath.rect(0, 0, w, h);
    clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip(clipPath, 'evenodd');
    ctx.globalAlpha = 1 - (0.1 * p);
    drawScaledCanvas(ctx, leftCanvas, w, h, 1 - (0.04 * intensity * p));
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
