/**
 * Flip Transition Renderers
 *
 * Includes: flip, cube, page-turn
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
// Cube (3D cube rotation)
// ============================================================================

const cubeRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight, direction): TransitionStyleCalculation {
    const dir = (direction as FlipDirection) || 'from-left';
    const p = Math.max(0, Math.min(1, progress));
    const isHorizontal = dir === 'from-left' || dir === 'from-right';
    const sign = dir === 'from-right' || dir === 'from-bottom' ? -1 : 1;

    // Half the canvas dimension for perspective distance
    const halfDim = isHorizontal ? canvasWidth / 2 : canvasHeight / 2;
    const angle = p * 90;

    let transform: string;
    if (isOutgoing) {
      const rotAxis = isHorizontal ? 'Y' : 'X';
      const translateZ = halfDim;
      transform = `perspective(${halfDim * 4}px) translateZ(-${translateZ}px) rotate${rotAxis}(${sign * angle}deg) translateZ(${translateZ}px)`;
    } else {
      const rotAxis = isHorizontal ? 'Y' : 'X';
      const translateZ = halfDim;
      transform = `perspective(${halfDim * 4}px) translateZ(-${translateZ}px) rotate${rotAxis}(${sign * (angle - 90)}deg) translateZ(${translateZ}px)`;
    }

    return { transform };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    // Canvas 2D fallback: use flip approximation
    flipRenderer.renderCanvas!(ctx, leftCanvas, rightCanvas, progress, direction, canvas);
  },
};

const cubeDef: TransitionDefinition = {
  id: 'cube',
  label: 'Cube',
  description: '3D cube rotation between clips',
  category: 'flip',
  icon: 'Box',
  hasDirection: true,
  directions: ALL_DIRECTIONS,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Page Turn
// ============================================================================

const pageTurnRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Page curls away: combine rotation with origin at left edge
      const angle = p * 90;
      return {
        transform: `perspective(1200px) rotateY(${-angle}deg)`,
        // We'll use transform-origin via properties but CSS handles it
      };
    }
    // Incoming appears underneath
    return { opacity: p > 0.1 ? 1 : 0 };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    // Draw incoming underneath
    ctx.drawImage(rightCanvas, 0, 0);

    if (p < 1) {
      // Draw outgoing with squeeze effect (page turn approximation)
      ctx.save();
      const scale = Math.cos(p * Math.PI / 2);
      ctx.translate(0, 0);
      ctx.scale(scale, 1);
      ctx.globalAlpha = 1 - p * 0.3;
      ctx.drawImage(leftCanvas, 0, 0, w, h);
      ctx.restore();
    }
  },
};

const pageTurnDef: TransitionDefinition = {
  id: 'page-turn',
  label: 'Page Turn',
  description: 'Page curl effect',
  category: 'flip',
  icon: 'BookOpen',
  hasDirection: false,
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
  registry.register('cube', cubeDef, cubeRenderer);
  registry.register('page-turn', pageTurnDef, pageTurnRenderer);
}
