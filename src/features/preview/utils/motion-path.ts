import type { ItemKeyframes } from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import type { CoordinateParams, Point } from '../types/gizmo'
import { resolveItemTransformAtFrame } from '../deps/composition-runtime'
import { getEffectiveScale } from './coordinate-transform'

export interface MotionPathPoint {
  frame: number
  x: number
  y: number
  isKeyframe: boolean
}

export interface MotionPathScreenPoint extends MotionPathPoint {
  screenX: number
  screenY: number
}

function hasPositionKeyframes(itemKeyframes: ItemKeyframes | undefined): boolean {
  return (
    itemKeyframes?.properties.some(
      (property) =>
        (property.property === 'x' || property.property === 'y') && property.keyframes.length > 0,
    ) ?? false
  )
}

/** Procedural modifiers that move the item's position (drive a motion path). */
function hasPositionModifiers(item: TimelineItem): boolean {
  return (
    item.motionModifiers?.some(
      (modifier) =>
        modifier.enabled &&
        modifier.amplitude > 0 &&
        (modifier.type === 'float-drift' || modifier.type === 'micro-shake'),
    ) ?? false
  )
}

function getPositionKeyframeFrames(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
): Set<number> {
  const frames = new Set<number>()
  for (const property of itemKeyframes?.properties ?? []) {
    if (property.property !== 'x' && property.property !== 'y') continue
    for (const keyframe of property.keyframes) {
      const absoluteFrame = item.from + keyframe.frame
      if (absoluteFrame >= item.from && absoluteFrame < item.from + item.durationInFrames) {
        frames.add(absoluteFrame)
      }
    }
  }
  return frames
}

function getEvenSampleFrames(startFrame: number, endFrame: number, maxSamples: number): number[] {
  const span = endFrame - startFrame
  if (span <= 0) return [startFrame]

  const sampleCount = Math.max(2, Math.min(maxSamples, span + 1))
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.round(startFrame + (span * index) / (sampleCount - 1)),
  )
}

function hasVisibleMovement(points: MotionPathPoint[]): boolean {
  const first = points[0]
  if (!first) return false
  return points.some(
    (point) => Math.abs(point.x - first.x) > 0.5 || Math.abs(point.y - first.y) > 0.5,
  )
}

export function buildMotionPathPoints(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  canvas: CanvasSettings
  maxSamples?: number
}): MotionPathPoint[] {
  const { item, itemKeyframes, canvas } = params
  if (!hasPositionKeyframes(itemKeyframes) && !hasPositionModifiers(item)) return []

  const startFrame = item.from
  const endFrame = item.from + Math.max(0, item.durationInFrames - 1)
  if (endFrame <= startFrame) return []

  const keyframeFrames = getPositionKeyframeFrames(item, itemKeyframes)
  const frames = new Set([
    ...getEvenSampleFrames(startFrame, endFrame, Math.max(2, params.maxSamples ?? 36)),
    ...keyframeFrames,
  ])

  const points = Array.from(frames)
    .sort((left, right) => left - right)
    .map((frame) => {
      const transform = resolveItemTransformAtFrame(item, {
        canvas,
        frame,
        keyframes: itemKeyframes,
      })
      return {
        frame,
        x: canvas.width / 2 + transform.x,
        y: canvas.height / 2 + transform.y,
        isKeyframe: keyframeFrames.has(frame),
      }
    })

  return hasVisibleMovement(points) ? points : []
}

export function canvasPointToMotionPathScreenPoint(
  point: MotionPathPoint,
  coordParams: CoordinateParams,
): MotionPathScreenPoint {
  const scale = getEffectiveScale(coordParams)
  return {
    ...point,
    screenX: point.x * scale,
    screenY: point.y * scale,
  }
}

export function canvasPointToPlayerPoint(point: Point, coordParams: CoordinateParams): Point {
  const scale = getEffectiveScale(coordParams)
  return {
    x: point.x * scale,
    y: point.y * scale,
  }
}
