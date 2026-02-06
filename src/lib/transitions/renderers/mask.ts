/**
 * Mask Transition Renderers
 *
 * Includes: clockWipe, iris, heart, star, diamond
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Clock Wipe
// ============================================================================

const clockWipeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      const degrees = p * 360;
      const maskImage = `conic-gradient(from 0deg, transparent ${degrees}deg, black ${degrees}deg)`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.sqrt(w * w + h * h);
    const startAngle = -Math.PI / 2;
    const sweepAngle = p * Math.PI * 2;
    const currentAngle = startAngle + sweepAngle;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const clipPath = new Path2D();
    clipPath.moveTo(centerX, centerY);
    clipPath.arc(centerX, centerY, radius, currentAngle, startAngle + Math.PI * 2, false);
    clipPath.closePath();
    ctx.clip(clipPath);
    ctx.drawImage(leftCanvas, 0, 0);
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
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      const maxRadius = 120;
      const radius = p * maxRadius;
      const maskImage = `radial-gradient(circle, transparent ${radius}%, black ${radius}%)`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const maxRadius = Math.sqrt(Math.pow(w / 2, 2) + Math.pow(h / 2, 2)) * 1.2;
    const radius = p * maxRadius;
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const clipPath = new Path2D();
    clipPath.rect(0, 0, w, h);
    clipPath.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip(clipPath, 'evenodd');
    ctx.drawImage(leftCanvas, 0, 0);
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
// Heart
// ============================================================================

const heartRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Use radial gradient as mask expanding in heart-like shape
      const size = p * 200;
      const maskImage = `radial-gradient(ellipse ${size}% ${size * 0.8}% at 50% 55%, transparent 40%, black 41%)`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.drawImage(rightCanvas, 0, 0);

    if (p < 1) {
      ctx.save();
      // Heart shape via two circles and a triangle (simplified)
      const size = p * Math.max(w, h) * 0.8;
      const r = size * 0.3;
      const clipPath = new Path2D();
      // Full canvas minus heart = keep outgoing outside heart
      clipPath.rect(0, 0, w, h);
      // Heart shape
      const heartPath = new Path2D();
      heartPath.arc(cx - r * 0.6, cy - r * 0.2, r, 0, Math.PI * 2);
      heartPath.arc(cx + r * 0.6, cy - r * 0.2, r, 0, Math.PI * 2);
      heartPath.moveTo(cx - r * 1.2, cy);
      heartPath.lineTo(cx, cy + r * 1.4);
      heartPath.lineTo(cx + r * 1.2, cy);
      heartPath.closePath();
      // Combine
      clipPath.addPath(heartPath);
      ctx.clip(clipPath, 'evenodd');
      ctx.drawImage(leftCanvas, 0, 0);
      ctx.restore();
    }
  },
};

const heartDef: TransitionDefinition = {
  id: 'heart',
  label: 'Heart',
  description: 'Heart shape reveal',
  category: 'mask',
  icon: 'Heart',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Star
// ============================================================================

function starPath(cx: number, cy: number, outerR: number, innerR: number, points: number): Path2D {
  const path = new Path2D();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

const starRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      const size = p * 200;
      // Star-like mask using alternating radial gradients
      const maskImage = `radial-gradient(circle, transparent ${size * 0.4}%, black ${size * 0.6}%)`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const maxR = Math.sqrt(w * w + h * h) / 2 * 1.2;
    const outerR = p * maxR;
    const innerR = outerR * 0.4;

    ctx.drawImage(rightCanvas, 0, 0);
    if (p < 1) {
      ctx.save();
      const clip = new Path2D();
      clip.rect(0, 0, w, h);
      clip.addPath(starPath(w / 2, h / 2, outerR, innerR, 5));
      ctx.clip(clip, 'evenodd');
      ctx.drawImage(leftCanvas, 0, 0);
      ctx.restore();
    }
  },
};

const starDef: TransitionDefinition = {
  id: 'star',
  label: 'Star',
  description: 'Star shape reveal',
  category: 'mask',
  icon: 'Star',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Diamond
// ============================================================================

const diamondRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Diamond shape via mask approach (radial gradient approximation)
      const maskImage = `radial-gradient(circle, transparent ${p * 100}%, black ${p * 100}%)`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxSize = Math.max(w, h) * 0.8;
    const size = p * maxSize;

    ctx.drawImage(rightCanvas, 0, 0);
    if (p < 1) {
      ctx.save();
      const clip = new Path2D();
      clip.rect(0, 0, w, h);
      const diamond = new Path2D();
      diamond.moveTo(cx, cy - size);
      diamond.lineTo(cx + size, cy);
      diamond.lineTo(cx, cy + size);
      diamond.lineTo(cx - size, cy);
      diamond.closePath();
      clip.addPath(diamond);
      ctx.clip(clip, 'evenodd');
      ctx.drawImage(leftCanvas, 0, 0);
      ctx.restore();
    }
  },
};

const diamondDef: TransitionDefinition = {
  id: 'diamond',
  label: 'Diamond',
  description: 'Diamond shape reveal',
  category: 'mask',
  icon: 'Diamond',
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
  registry.register('heart', heartDef, heartRenderer);
  registry.register('star', starDef, starRenderer);
  registry.register('diamond', diamondDef, diamondRenderer);
}
