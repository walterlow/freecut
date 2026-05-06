/**
 * Basic Transition Renderers
 *
 * Includes: fade
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionStyleCalculation } from '../engine'
import type { TransitionDefinition } from '@/types/transition'

// ============================================================================
// Fade
// ============================================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function calculateFadeDipOpacity(progress: number, isOutgoing: boolean): number {
  if (progress < 0.5) {
    return isOutgoing ? Math.max(0, Math.cos(progress * Math.PI)) : 0
  }
  return isOutgoing ? 0 : Math.max(0, -Math.cos(progress * Math.PI))
}

const fadeRenderer: TransitionRenderer = {
  gpuTransitionId: 'fade',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    return {
      opacity: calculateFadeDipOpacity(p, isOutgoing),
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    const p = clamp01(progress)
    const outgoingWeight = calculateFadeDipOpacity(p, true)
    const incomingWeight = calculateFadeDipOpacity(p, false)
    const w = Math.max(leftCanvas.width, rightCanvas.width)
    const h = Math.max(leftCanvas.height, rightCanvas.height)

    ctx.save()
    ctx.globalCompositeOperation = 'copy'
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, w, h)

    if (outgoingWeight > 0) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = outgoingWeight
      ctx.drawImage(leftCanvas, 0, 0)
    }

    if (incomingWeight > 0) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = incomingWeight
      ctx.drawImage(rightCanvas, 0, 0)
    }
    ctx.restore()
  },
}

const fadeDef: TransitionDefinition = {
  id: 'fade',
  label: 'Fade',
  description: 'Dip through black between clips',
  category: 'basic',
  icon: 'Blend',
  hasDirection: false,
  supportedTimings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

// ============================================================================
// Registration
// ============================================================================

export function registerBasicTransitions(registry: TransitionRegistry): void {
  registry.register('fade', fadeDef, fadeRenderer)
}
