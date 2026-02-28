/**
 * Flip Transition Renderers
 *
 * Includes: flip
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, FlipDirection } from '@/types/transition';

const ALL_DIRECTIONS: FlipDirection[] = ['from-left', 'from-right', 'from-top', 'from-bottom'];
const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Flip
// ============================================================================

const flipRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, _cw, _ch, direction): TransitionStyleCalculation {
    const dir = (direction as FlipDirection) || 'from-left';
    const axis = dir === 'from-left' || dir === 'from-right' ? 'Y' : 'X';
    const sign = dir === 'from-right' || dir === 'from-bottom' ? -1 : 1;
    const midpoint = 0.5;

    const flipOpacity = isOutgoing
      ? progress < midpoint ? 1 : 0
      : progress >= midpoint ? 1 : 0;

    let transform: string;
    if (isOutgoing) {
      const flipProgress = Math.min(progress / midpoint, 1);
      transform = `perspective(1000px) rotate${axis}(${sign * flipProgress * 90}deg)`;
    } else {
      const flipProgress = Math.max((progress - midpoint) / midpoint, 0);
      transform = `perspective(1000px) rotate${axis}(${sign * (-90 + flipProgress * 90)}deg)`;
    }

    return { transform, opacity: flipOpacity };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const dir = (direction as FlipDirection) || 'from-left';
    const isHorizontal = dir === 'from-left' || dir === 'from-right';
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const midpoint = 0.5;

    if (p < midpoint) {
      const flipProgress = p / midpoint;
      const scale = Math.cos(flipProgress * Math.PI / 2);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      if (isHorizontal) { ctx.scale(scale, 1); } else { ctx.scale(1, scale); }
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(leftCanvas, 0, 0);
      ctx.restore();
    } else {
      const flipProgress = (p - midpoint) / midpoint;
      const scale = Math.sin(flipProgress * Math.PI / 2);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      if (isHorizontal) { ctx.scale(scale, 1); } else { ctx.scale(1, scale); }
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(rightCanvas, 0, 0);
      ctx.restore();
    }
  },
};

const flipDef: TransitionDefinition = {
  id: 'flip',
  label: 'Flip',
  description: '3D flip transition',
  category: 'flip',
  icon: 'FlipHorizontal',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Registration
// ============================================================================

export function registerFlipTransitions(registry: TransitionRegistry): void {
  registry.register('flip', flipDef, flipRenderer);
}
