/**
 * Shape Transition Renderers
 *
 * Shape aperture reveals inspired by editorial NLE shape transitions.
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

type ShapeAperture = 'box' | 'heart' | 'star' | 'triangleLeft' | 'triangleRight'

interface Point {
  x: number
  y: number
}

interface ShapeVariant {
  id: string
  label: string
  description: string
  icon: string
  shape: ShapeAperture
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getShapeScale(
  shape: ShapeAperture,
  progress: number,
  width: number,
  height: number,
): number {
  if (shape === 'box') {
    return clamp01(progress) * Math.max(width / 2, height / (2 * 0.62)) * 1.12
  }
  return clamp01(progress) * Math.max(width, height) * 1.45
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

function getStarPoints(): Point[] {
  const points: Point[] = []
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2
    const radius = index % 2 === 0 ? 1 : 0.42
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    })
  }
  return points
}

function getPolygonPoints(shape: ShapeAperture): Point[] {
  switch (shape) {
    case 'box':
      return [
        { x: -1, y: -0.62 },
        { x: 1, y: -0.62 },
        { x: 1, y: 0.62 },
        { x: -1, y: 0.62 },
      ]
    case 'star':
      return getStarPoints()
    case 'triangleLeft':
      return [
        { x: -1, y: 0 },
        { x: 1, y: -0.68 },
        { x: 1, y: 0.68 },
      ]
    case 'triangleRight':
      return [
        { x: 1, y: 0 },
        { x: -1, y: -0.68 },
        { x: -1, y: 0.68 },
      ]
    default:
      return []
  }
}

function getHeartPath(centerX: number, centerY: number, scale: number): string {
  const s = scale
  return [
    `M ${centerX.toFixed(2)} ${(centerY + 0.78 * s).toFixed(2)}`,
    `C ${(centerX - 1.08 * s).toFixed(2)} ${(centerY + 0.12 * s).toFixed(2)} ${(centerX - 0.96 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)} ${(centerX - 0.36 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)}`,
    `C ${(centerX - 0.12 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)} ${(centerX + 0).toFixed(2)} ${(centerY - 0.58 * s).toFixed(2)} ${centerX.toFixed(2)} ${(centerY - 0.42 * s).toFixed(2)}`,
    `C ${centerX.toFixed(2)} ${(centerY - 0.58 * s).toFixed(2)} ${(centerX + 0.12 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)} ${(centerX + 0.36 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)}`,
    `C ${(centerX + 0.96 * s).toFixed(2)} ${(centerY - 0.78 * s).toFixed(2)} ${(centerX + 1.08 * s).toFixed(2)} ${(centerY + 0.12 * s).toFixed(2)} ${centerX.toFixed(2)} ${(centerY + 0.78 * s).toFixed(2)}`,
    'Z',
  ].join(' ')
}

export function getAperturePath(
  shape: ShapeAperture,
  width: number,
  height: number,
  progress: number,
): string {
  const p = clamp01(progress)
  if (shape === 'triangleLeft') {
    const x = width * p * 2
    const y = height * p * 2
    return `M 0 0 L ${x.toFixed(2)} 0 L 0 ${y.toFixed(2)} Z`
  }

  if (shape === 'triangleRight') {
    const x = width - width * p * 2
    const y = height * p * 2
    return `M ${width} 0 L ${x.toFixed(2)} 0 L ${width} ${y.toFixed(2)} Z`
  }

  const centerX = width / 2
  const centerY = height / 2
  const scale = getShapeScale(shape, p, width, height)

  if (shape === 'heart') {
    return getHeartPath(centerX, centerY, scale)
  }

  return pointsToPath(getPolygonPoints(shape), centerX, centerY, scale)
}

function createMaskSvg(
  shape: ShapeAperture,
  width: number,
  height: number,
  progress: number,
): string {
  const aperturePath = getAperturePath(shape, width, height, progress)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="white" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z ${aperturePath}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function addHeartPath(path: Path2D, centerX: number, centerY: number, scale: number): void {
  const s = scale
  path.moveTo(centerX, centerY + 0.78 * s)
  path.bezierCurveTo(
    centerX - 1.08 * s,
    centerY + 0.12 * s,
    centerX - 0.96 * s,
    centerY - 0.78 * s,
    centerX - 0.36 * s,
    centerY - 0.78 * s,
  )
  path.bezierCurveTo(
    centerX - 0.12 * s,
    centerY - 0.78 * s,
    centerX,
    centerY - 0.58 * s,
    centerX,
    centerY - 0.42 * s,
  )
  path.bezierCurveTo(
    centerX,
    centerY - 0.58 * s,
    centerX + 0.12 * s,
    centerY - 0.78 * s,
    centerX + 0.36 * s,
    centerY - 0.78 * s,
  )
  path.bezierCurveTo(
    centerX + 0.96 * s,
    centerY - 0.78 * s,
    centerX + 1.08 * s,
    centerY + 0.12 * s,
    centerX,
    centerY + 0.78 * s,
  )
  path.closePath()
}

function addAperturePath(
  path: Path2D,
  shape: ShapeAperture,
  width: number,
  height: number,
  progress: number,
): void {
  const p = clamp01(progress)
  if (shape === 'triangleLeft') {
    path.moveTo(0, 0)
    path.lineTo(width * p * 2, 0)
    path.lineTo(0, height * p * 2)
    path.closePath()
    return
  }

  if (shape === 'triangleRight') {
    path.moveTo(width, 0)
    path.lineTo(width - width * p * 2, 0)
    path.lineTo(width, height * p * 2)
    path.closePath()
    return
  }

  const centerX = width / 2
  const centerY = height / 2
  const scale = getShapeScale(shape, p, width, height)

  if (shape === 'heart') {
    addHeartPath(path, centerX, centerY, scale)
    return
  }

  const points = getPolygonPoints(shape)
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

function createShapeRenderer(shape: ShapeAperture): TransitionRenderer {
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

        const maskImage = createMaskSvg(shape, canvasWidth, canvasHeight, p)
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
      clipPath.rect(0, 0, w, h)
      addAperturePath(clipPath, shape, w, h, p)
      ctx.clip(clipPath, 'evenodd')
      ctx.drawImage(leftCanvas, 0, 0, w, h)
      ctx.restore()
    },
  }
}

const SHAPE_VARIANTS: ShapeVariant[] = [
  {
    id: 'boxShape',
    label: 'Box',
    description: 'Box-shaped reveal',
    icon: 'RectangleHorizontal',
    shape: 'box',
  },
  {
    id: 'heartShape',
    label: 'Heart',
    description: 'Heart-shaped reveal',
    icon: 'Heart',
    shape: 'heart',
  },
  {
    id: 'starShape',
    label: 'Star',
    description: 'Star-shaped reveal',
    icon: 'Star',
    shape: 'star',
  },
  {
    id: 'triangleLeftShape',
    label: 'Triangle Left',
    description: 'Left-pointing triangle reveal',
    icon: 'Triangle',
    shape: 'triangleLeft',
  },
  {
    id: 'triangleRightShape',
    label: 'Triangle Right',
    description: 'Right-pointing triangle reveal',
    icon: 'Triangle',
    shape: 'triangleRight',
  },
]

function createShapeDefinition(variant: ShapeVariant): TransitionDefinition {
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    category: 'shape',
    icon: variant.icon,
    hasDirection: false,
    supportedTimings: [...ALL_TIMINGS],
    defaultDuration: 30,
    minDuration: 10,
    maxDuration: 90,
  }
}

export function registerShapeTransitions(registry: TransitionRegistry): void {
  for (const variant of SHAPE_VARIANTS) {
    registry.register(
      variant.id,
      createShapeDefinition(variant),
      createShapeRenderer(variant.shape),
    )
  }
}
