/**
 * Motion Transition Renderers
 *
 * Includes shape-split reveals that complement the directional Push and Slide
 * transitions registered by the existing slide/wipe renderers.
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionStyleCalculation } from '../engine'
import type { TransitionDefinition } from '@/types/transition'

const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const

type MotionMask = 'barnDoor' | 'split'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function createOutgoingMaskSvg(
  kind: MotionMask,
  width: number,
  height: number,
  progress: number,
): string {
  const p = clamp01(progress)
  const centerX = width / 2
  const centerY = height / 2

  let paths: string
  if (kind === 'barnDoor') {
    const leftWidth = Math.max(0, centerX * (1 - p))
    const rightX = width - leftWidth
    paths = [
      `M0 0H${leftWidth.toFixed(2)}V${height}H0Z`,
      `M${rightX.toFixed(2)} 0H${width}V${height}H${rightX.toFixed(2)}Z`,
    ].join('')
  } else {
    const gapX = centerX * p
    const gapY = centerY * p
    const leftWidth = Math.max(0, centerX - gapX)
    const rightX = width - leftWidth
    const topHeight = Math.max(0, centerY - gapY)
    const bottomY = height - topHeight
    paths = [
      `M0 0H${leftWidth.toFixed(2)}V${topHeight.toFixed(2)}H0Z`,
      `M${rightX.toFixed(2)} 0H${width}V${topHeight.toFixed(2)}H${rightX.toFixed(2)}Z`,
      `M0 ${bottomY.toFixed(2)}H${leftWidth.toFixed(2)}V${height}H0Z`,
      `M${rightX.toFixed(2)} ${bottomY.toFixed(2)}H${width}V${height}H${rightX.toFixed(2)}Z`,
    ].join('')
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="white" d="${paths}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function addOutgoingMaskPath(
  path: Path2D,
  kind: MotionMask,
  width: number,
  height: number,
  progress: number,
): void {
  const p = clamp01(progress)
  const centerX = width / 2
  const centerY = height / 2

  if (kind === 'barnDoor') {
    const panelWidth = Math.max(0, centerX * (1 - p))
    path.rect(0, 0, panelWidth, height)
    path.rect(width - panelWidth, 0, panelWidth, height)
    return
  }

  const panelWidth = Math.max(0, centerX * (1 - p))
  const panelHeight = Math.max(0, centerY * (1 - p))
  path.rect(0, 0, panelWidth, panelHeight)
  path.rect(width - panelWidth, 0, panelWidth, panelHeight)
  path.rect(0, height - panelHeight, panelWidth, panelHeight)
  path.rect(width - panelWidth, height - panelHeight, panelWidth, panelHeight)
}

function createMotionMaskRenderer(kind: MotionMask): TransitionRenderer {
  return {
    calculateStyles(progress, isOutgoing, canvasWidth, canvasHeight): TransitionStyleCalculation {
      const p = clamp01(progress)

      if (isOutgoing) {
        if (p <= 0) {
          return { opacity: 1 }
        }
        if (p >= 1) {
          return { opacity: 0 }
        }

        const maskImage = createOutgoingMaskSvg(kind, canvasWidth, canvasHeight, p)
        return {
          maskImage,
          webkitMaskImage: maskImage,
          maskSize: '100% 100%',
          webkitMaskSize: '100% 100%',
          opacity: 1,
        }
      }

      return { opacity: 1 }
    },
    renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
      const p = clamp01(progress)
      const w = canvas?.width ?? leftCanvas.width
      const h = canvas?.height ?? leftCanvas.height

      ctx.drawImage(rightCanvas, 0, 0, w, h)

      ctx.save()
      const clipPath = new Path2D()
      addOutgoingMaskPath(clipPath, kind, w, h, p)
      ctx.clip(clipPath)
      ctx.drawImage(leftCanvas, 0, 0, w, h)
      ctx.restore()
    },
  }
}

const barnDoorDef: TransitionDefinition = {
  id: 'barnDoor',
  label: 'Barn Door',
  description: 'Center-opening two-panel reveal',
  category: 'motion',
  icon: 'Columns2',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

const splitDef: TransitionDefinition = {
  id: 'split',
  label: 'Split',
  description: 'Four-panel split reveal',
  category: 'motion',
  icon: 'SplitSquareVertical',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 5,
  maxDuration: 90,
}

export function registerMotionTransitions(registry: TransitionRegistry): void {
  registry.register('barnDoor', barnDoorDef, createMotionMaskRenderer('barnDoor'))
  registry.register('split', splitDef, createMotionMaskRenderer('split'))
}
