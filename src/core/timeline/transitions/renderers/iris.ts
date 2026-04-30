/**
 * Iris Transition Renderers
 *
 * Shape-based aperture reveals inspired by editorial NLE iris transitions.
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionStyleCalculation } from '../engine'
import type { TransitionDefinition } from '@/types/transition'

const ALL_TIMINGS = [
  'linear',
  'spring',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier',
] as const

type IrisShape =
  | 'arrow'
  | 'cross'
  | 'diamond'
  | 'eye'
  | 'hexagon'
  | 'oval'
  | 'pentagon'
  | 'square'
  | 'triangle'

interface Point {
  x: number
  y: number
}

interface IrisVariant {
  id: string
  label: string
  description: string
  icon: string
  shape: IrisShape
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getNumericProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const raw = properties?.[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback
  }
  return raw
}

function getIrisScale(progress: number, width: number, height: number): number {
  return clamp01(progress) * Math.max(width, height) * 1.45
}

function polygonPoints(sides: number, rotation = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
    }
  })
}

function getUnitPoints(shape: IrisShape): Point[] {
  switch (shape) {
    case 'arrow':
      return [
        { x: 0, y: -1 },
        { x: 0.68, y: 1 },
        { x: 0, y: 0.36 },
        { x: -0.68, y: 1 },
      ]
    case 'cross':
      return [
        { x: -0.28, y: -1 },
        { x: 0.28, y: -1 },
        { x: 0.28, y: -0.28 },
        { x: 1, y: -0.28 },
        { x: 1, y: 0.28 },
        { x: 0.28, y: 0.28 },
        { x: 0.28, y: 1 },
        { x: -0.28, y: 1 },
        { x: -0.28, y: 0.28 },
        { x: -1, y: 0.28 },
        { x: -1, y: -0.28 },
        { x: -0.28, y: -0.28 },
      ]
    case 'diamond':
      return polygonPoints(4)
    case 'hexagon':
      return polygonPoints(6, 0)
    case 'pentagon':
      return polygonPoints(5)
    case 'square':
      return [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ]
    case 'triangle':
      return polygonPoints(3)
    default:
      return []
  }
}

function pointsToPath(points: Point[], centerX: number, centerY: number, scale: number): string {
  return points
    .map((point, index) => {
      const x = centerX + point.x * scale
      const y = centerY + point.y * scale
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
    .concat(' Z')
}

function getEllipseRadii(
  shape: IrisShape,
  width: number,
  height: number,
  scale: number,
): { rx: number; ry: number } {
  if (shape === 'eye') {
    return { rx: scale * 1.02, ry: scale * 0.42 }
  }

  const aspect = width >= height ? 1.15 : 0.85
  return { rx: scale * aspect, ry: scale * 0.72 }
}

function getAperturePath(
  shape: IrisShape,
  width: number,
  height: number,
  progress: number,
): string {
  const p = clamp01(progress)
  const centerX = width / 2
  const centerY = height / 2
  const scale = getIrisScale(p, width, height)

  if (shape === 'oval') {
    const { rx, ry } = getEllipseRadii(shape, width, height, scale)
    return [
      `M ${(centerX - rx).toFixed(2)} ${centerY.toFixed(2)}`,
      `A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(centerX + rx).toFixed(2)} ${centerY.toFixed(2)}`,
      `A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(centerX - rx).toFixed(2)} ${centerY.toFixed(2)}`,
      'Z',
    ].join(' ')
  }

  if (shape === 'eye') {
    const { rx, ry } = getEllipseRadii(shape, width, height, scale)
    return [
      `M ${(centerX - rx).toFixed(2)} ${centerY.toFixed(2)}`,
      `C ${(centerX - rx * 0.5).toFixed(2)} ${(centerY - ry).toFixed(2)} ${(centerX + rx * 0.5).toFixed(2)} ${(centerY - ry).toFixed(2)} ${(centerX + rx).toFixed(2)} ${centerY.toFixed(2)}`,
      `C ${(centerX + rx * 0.5).toFixed(2)} ${(centerY + ry).toFixed(2)} ${(centerX - rx * 0.5).toFixed(2)} ${(centerY + ry).toFixed(2)} ${(centerX - rx).toFixed(2)} ${centerY.toFixed(2)}`,
      'Z',
    ].join(' ')
  }

  return pointsToPath(getUnitPoints(shape), centerX, centerY, scale)
}

function createMaskSvg(shape: IrisShape, width: number, height: number, progress: number): string {
  const aperturePath = getAperturePath(shape, width, height, progress)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="white" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z ${aperturePath}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function addAperturePath(
  path: Path2D,
  shape: IrisShape,
  width: number,
  height: number,
  progress: number,
): void {
  const p = clamp01(progress)
  const centerX = width / 2
  const centerY = height / 2
  const scale = getIrisScale(p, width, height)

  if (shape === 'oval' || shape === 'eye') {
    const { rx, ry } = getEllipseRadii(shape, width, height, scale)
    if (shape === 'eye') {
      path.moveTo(centerX - rx, centerY)
      path.bezierCurveTo(
        centerX - rx * 0.5,
        centerY - ry,
        centerX + rx * 0.5,
        centerY - ry,
        centerX + rx,
        centerY,
      )
      path.bezierCurveTo(
        centerX + rx * 0.5,
        centerY + ry,
        centerX - rx * 0.5,
        centerY + ry,
        centerX - rx,
        centerY,
      )
      path.closePath()
      return
    }

    path.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2)
    return
  }

  const points = getUnitPoints(shape)
  points.forEach((point, index) => {
    const x = centerX + point.x * scale
    const y = centerY + point.y * scale
    if (index === 0) {
      path.moveTo(x, y)
    } else {
      path.lineTo(x, y)
    }
  })
  path.closePath()
}

function createIrisRenderer(shape: IrisShape): TransitionRenderer {
  return {
    calculateStyles(
      progress,
      isOutgoing,
      canvasWidth,
      canvasHeight,
      _dir,
      properties,
    ): TransitionStyleCalculation {
      const p = clamp01(progress)
      const outgoingDim = Math.max(
        0,
        Math.min(0.12, getNumericProperty(properties, 'outgoingDim', 0.06)),
      )

      if (isOutgoing) {
        if (p <= 0) {
          return { opacity: 1 }
        }
        if (p >= 1) {
          return { opacity: 0 }
        }

        const maskImage = createMaskSvg(shape, canvasWidth, canvasHeight, p)
        return {
          maskImage,
          webkitMaskImage: maskImage,
          maskSize: '100% 100%',
          webkitMaskSize: '100% 100%',
          opacity: 1 - outgoingDim * p,
        }
      }

      return {
        opacity: 0.9 + 0.1 * p,
      }
    },
    renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, canvas, properties) {
      const p = clamp01(progress)
      const w = canvas?.width ?? leftCanvas.width
      const h = canvas?.height ?? leftCanvas.height
      const outgoingDim = Math.max(
        0,
        Math.min(0.12, getNumericProperty(properties, 'outgoingDim', 0.06)),
      )

      ctx.save()
      ctx.globalAlpha = 0.9 + 0.1 * p
      ctx.drawImage(rightCanvas, 0, 0, w, h)
      ctx.restore()

      ctx.save()
      const clipPath = new Path2D()
      clipPath.rect(0, 0, w, h)
      addAperturePath(clipPath, shape, w, h, p)
      ctx.clip(clipPath, 'evenodd')
      ctx.globalAlpha = 1 - outgoingDim * p
      ctx.drawImage(leftCanvas, 0, 0, w, h)
      ctx.restore()
    },
  }
}

const IRIS_VARIANTS: IrisVariant[] = [
  {
    id: 'arrowIris',
    label: 'Arrow Iris',
    description: 'Arrow-shaped iris reveal',
    icon: 'ArrowUp',
    shape: 'arrow',
  },
  {
    id: 'crossIris',
    label: 'Cross Iris',
    description: 'Cross-shaped iris reveal',
    icon: 'Plus',
    shape: 'cross',
  },
  {
    id: 'diamondIris',
    label: 'Diamond Iris',
    description: 'Diamond-shaped iris reveal',
    icon: 'Diamond',
    shape: 'diamond',
  },
  {
    id: 'eyeIris',
    label: 'Eye Iris',
    description: 'Eye-shaped iris reveal',
    icon: 'Eye',
    shape: 'eye',
  },
  {
    id: 'hexagonIris',
    label: 'Hexagon Iris',
    description: 'Hexagon-shaped iris reveal',
    icon: 'Hexagon',
    shape: 'hexagon',
  },
  {
    id: 'ovalIris',
    label: 'Oval Iris',
    description: 'Oval-shaped iris reveal',
    icon: 'Circle',
    shape: 'oval',
  },
  {
    id: 'pentagonIris',
    label: 'Pentagon Iris',
    description: 'Pentagon-shaped iris reveal',
    icon: 'Pentagon',
    shape: 'pentagon',
  },
  {
    id: 'squareIris',
    label: 'Square Iris',
    description: 'Square-shaped iris reveal',
    icon: 'Square',
    shape: 'square',
  },
  {
    id: 'triangleIris',
    label: 'Triangle Iris',
    description: 'Triangle-shaped iris reveal',
    icon: 'Triangle',
    shape: 'triangle',
  },
]

function createIrisDefinition(variant: IrisVariant): TransitionDefinition {
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    category: 'iris',
    icon: variant.icon,
    hasDirection: false,
    supportedTimings: [...ALL_TIMINGS],
    defaultDuration: 30,
    minDuration: 10,
    maxDuration: 90,
    parameters: [
      {
        key: 'outgoingDim',
        label: 'Dim',
        type: 'number',
        defaultValue: 0.06,
        min: 0,
        max: 0.12,
        step: 0.005,
        description: 'Outgoing clip dim amount during the reveal',
      },
    ],
  }
}

export function registerIrisTransitions(registry: TransitionRegistry): void {
  for (const variant of IRIS_VARIANTS) {
    registry.register(variant.id, createIrisDefinition(variant), createIrisRenderer(variant.shape))
  }
}
