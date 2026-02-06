/**
 * Zoom Transition Renderers
 *
 * Includes: zoom-in, zoom-out
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Zoom In
// ============================================================================

const zoomInRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Outgoing zooms in and fades out
      const scale = 1 + p * 0.5;
      return {
        transform: `scale(${scale})`,
        opacity: 1 - p,
      };
    }
    // Incoming fades in normally
    return { opacity: p };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    // Draw incoming
    ctx.save();
    ctx.globalAlpha = p;
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    // Draw outgoing zooming in
    ctx.save();
    ctx.globalAlpha = 1 - p;
    const scale = 1 + p * 0.5;
    const dx = (w * (1 - scale)) / 2;
    const dy = (h * (1 - scale)) / 2;
    ctx.drawImage(leftCanvas, dx, dy, w * scale, h * scale);
    ctx.restore();
  },
};

const zoomInDef: TransitionDefinition = {
  id: 'zoom-in',
  label: 'Zoom In',
  description: 'Zoom into center',
  category: 'zoom',
  icon: 'ZoomIn',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Zoom Out
// ============================================================================

const zoomOutRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    if (isOutgoing) {
      // Outgoing shrinks and fades
      const scale = 1 - p * 0.5;
      return {
        transform: `scale(${scale})`,
        opacity: 1 - p,
      };
    }
    // Incoming zooms out from large to normal
    const scale = 1.5 - p * 0.5;
    return {
      transform: `scale(${scale})`,
      opacity: p,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    // Draw incoming (zooming from large)
    ctx.save();
    ctx.globalAlpha = p;
    const inScale = 1.5 - p * 0.5;
    const inDx = (w * (1 - inScale)) / 2;
    const inDy = (h * (1 - inScale)) / 2;
    ctx.drawImage(rightCanvas, inDx, inDy, w * inScale, h * inScale);
    ctx.restore();

    // Draw outgoing (shrinking)
    ctx.save();
    ctx.globalAlpha = 1 - p;
    const outScale = 1 - p * 0.5;
    const outDx = (w * (1 - outScale)) / 2;
    const outDy = (h * (1 - outScale)) / 2;
    ctx.drawImage(leftCanvas, outDx, outDy, w * outScale, h * outScale);
    ctx.restore();
  },
};

const zoomOutDef: TransitionDefinition = {
  id: 'zoom-out',
  label: 'Zoom Out',
  description: 'Zoom outward',
  category: 'zoom',
  icon: 'ZoomOut',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Registration
// ============================================================================

export function registerZoomTransitions(registry: TransitionRegistry): void {
  registry.register('zoom-in', zoomInDef, zoomInRenderer);
  registry.register('zoom-out', zoomOutDef, zoomOutRenderer);
}
