/**
 * Wipe Transition Renderers
 *
 * Includes: wipe, barn-door, venetian-blinds, diagonal-wipe
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, WipeDirection } from '@/types/transition';

const ALL_DIRECTIONS: WipeDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom'];
const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Wipe
// ============================================================================

function calculateWipeClipPath(progress: number, direction: WipeDirection, isOutgoing: boolean): string {
  const p = isOutgoing ? progress : 1 - progress;
  switch (direction) {
    case 'from-left':
      return isOutgoing
        ? `inset(0 0 0 ${p * 100}%)`
        : `inset(0 ${p * 100}% 0 0)`;
    case 'from-right':
      return isOutgoing
        ? `inset(0 ${p * 100}% 0 0)`
        : `inset(0 0 0 ${p * 100}%)`;
    case 'from-top':
      return isOutgoing
        ? `inset(${p * 100}% 0 0 0)`
        : `inset(0 0 ${p * 100}% 0)`;
    case 'from-bottom':
      return isOutgoing
        ? `inset(0 0 ${p * 100}% 0)`
        : `inset(${p * 100}% 0 0 0)`;
    default:
      return 'none';
  }
}

const wipeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, _cw, _ch, direction): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      const clipPath = calculateWipeClipPath(p, (direction as WipeDirection) || 'from-left', true);
      return { clipPath, webkitClipPath: clipPath };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const dir = (direction as WipeDirection) || 'from-left';
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const ep = p; // effective progress for outgoing
    const path = new Path2D();
    switch (dir) {
      case 'from-left':
        path.rect(ep * w, 0, w, h); break;
      case 'from-right':
        path.rect(0, 0, (1 - ep) * w, h); break;
      case 'from-top':
        path.rect(0, ep * h, w, h); break;
      case 'from-bottom':
        path.rect(0, 0, w, (1 - ep) * h); break;
    }
    ctx.clip(path);
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
// Barn Door
// ============================================================================

const barnDoorRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Split from center: two halves slide outward
      const half = (p * 50);
      const clipPath = `inset(0 ${half}%)`;
      return { clipPath, webkitClipPath: clipPath };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const gap = p * w / 2;
    const path = new Path2D();
    // Left half
    path.rect(0, 0, w / 2 - gap, h);
    // Right half
    path.rect(w / 2 + gap, 0, w / 2 - gap, h);
    ctx.clip(path);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const barnDoorDef: TransitionDefinition = {
  id: 'barn-door',
  label: 'Barn Door',
  description: 'Splits open from center',
  category: 'wipe',
  icon: 'Columns2',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
};

// ============================================================================
// Venetian Blinds
// ============================================================================

const venetianBlindsRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    const isVertical = direction === 'from-top' || direction === 'from-bottom';
    const blindCount = 8;

    if (isOutgoing) {
      // Generate repeating linear gradient mask
      const size = isVertical ? canvasHeight : canvasWidth;
      const blindSize = size / blindCount;
      const revealPx = p * blindSize;
      const gradientDir = isVertical ? 'to bottom' : 'to right';

      const stops: string[] = [];
      for (let i = 0; i < blindCount; i++) {
        const start = (i / blindCount) * 100;
        const reveal = start + (revealPx / size) * 100;
        stops.push(`transparent ${start}%, transparent ${reveal}%, black ${reveal}%`);
        if (i < blindCount - 1) {
          const end = ((i + 1) / blindCount) * 100;
          stops.push(`black ${end}%`);
        }
      }
      const maskImage = `linear-gradient(${gradientDir}, ${stops.join(', ')})`;
      return { maskImage, webkitMaskImage: maskImage, maskSize: '100% 100%', webkitMaskSize: '100% 100%' };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const isVertical = direction === 'from-top' || direction === 'from-bottom';
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const blindCount = 8;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const path = new Path2D();
    const blindSize = (isVertical ? h : w) / blindCount;
    const revealPx = p * blindSize;

    for (let i = 0; i < blindCount; i++) {
      const start = i * blindSize + revealPx;
      const end = (i + 1) * blindSize;
      if (start < end) {
        if (isVertical) {
          path.rect(0, start, w, end - start);
        } else {
          path.rect(start, 0, end - start, h);
        }
      }
    }
    ctx.clip(path);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const venetianBlindsDef: TransitionDefinition = {
  id: 'venetian-blinds',
  label: 'Venetian Blinds',
  description: 'Horizontal or vertical blinds reveal',
  category: 'wipe',
  icon: 'AlignJustify',
  hasDirection: true,
  directions: ['from-left', 'from-top'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Diagonal Wipe
// ============================================================================

const diagonalWipeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Diagonal reveal using polygon from top-right to bottom-left
      const x = p * 150;
      const clipPath = `polygon(${x}% 0%, 100% 0%, 100% 100%, ${x - 50}% 100%)`;
      return { clipPath, webkitClipPath: clipPath };
    }
    return {};
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    ctx.drawImage(rightCanvas, 0, 0);
    ctx.save();
    const x = p * 1.5;
    const path = new Path2D();
    path.moveTo(x * w, 0);
    path.lineTo(w, 0);
    path.lineTo(w, h);
    path.lineTo((x - 0.5) * w, h);
    path.closePath();
    ctx.clip(path);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const diagonalWipeDef: TransitionDefinition = {
  id: 'diagonal-wipe',
  label: 'Diagonal Wipe',
  description: 'Corner-to-corner diagonal wipe',
  category: 'wipe',
  icon: 'TrendingUp',
  hasDirection: false,
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
  registry.register('barn-door', barnDoorDef, barnDoorRenderer);
  registry.register('venetian-blinds', venetianBlindsDef, venetianBlindsRenderer);
  registry.register('diagonal-wipe', diagonalWipeDef, diagonalWipeRenderer);
}
