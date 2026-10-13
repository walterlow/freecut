import type { AutoKeyframeOperation } from '@/features/preview/deps/keyframes'
import {
  getAutoKeyframeOperation,
  getVectorAutoKeyframeOperation,
  removeMotionAnimationLayers,
  removeMotionModifiers,
} from '@/features/preview/deps/keyframes'
import type { ItemKeyframes, TransformAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings, ResolvedTransform, TransformProperties } from '@/types/transform'
import { worldToLocalTransform } from '@/shared/utils/transform-parenting'
import { resolveItemTransformAtFrame } from '@/features/preview/deps/composition-runtime'

const SCALAR_GIZMO_PROPERTIES = ['x', 'y', 'width', 'height', 'rotation'] as const
const ANCHOR_GIZMO_PROPERTIES = ['x', 'y', 'anchorX', 'anchorY'] as const

/**
 * Resolve the parent's hierarchy transform in the same coordinate space used
 * to create transform-parent bindings. Display transforms can include a second
 * text-bounds expansion for inspector/gizmo presentation, so they are not safe
 * inputs for converting a child's world-space drag back to local space.
 */
export function resolveGizmoCommitParentWorld(params: {
  item: TimelineItem
  canvas: CanvasSettings
  frame: number
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}): ResolvedTransform | undefined {
  const parentId = params.item.transformParent?.parentItemId
  if (!parentId) return undefined
  const parent = params.getItem(parentId)
  if (!parent) return undefined

  return resolveItemTransformAtFrame(parent, {
    canvas: params.canvas,
    frame: params.frame,
    keyframes: params.getKeyframes(parent.id),
    getItem: params.getItem,
    getKeyframes: params.getKeyframes,
  })
}

export function resolveEditableGizmoTransform(params: {
  item: TimelineItem
  visualTransform: ResolvedTransform
  parentVisualTransform?: ResolvedTransform
  relativeFrame: number
  fps: number
  frameWidth: number
  frameHeight: number
}): ResolvedTransform {
  const localVisual = worldToLocalTransform(
    params.visualTransform,
    params.item.transformParent,
    params.parentVisualTransform,
  )
  const withoutModifiers = removeMotionModifiers(localVisual, params.item.motionModifiers, {
    frame: params.relativeFrame,
    fps: params.fps,
    frameWidth: params.frameWidth,
    frameHeight: params.frameHeight,
  })
  return removeMotionAnimationLayers(
    withoutModifiers,
    params.item.motionLayers,
    params.relativeFrame,
  )
}

export function buildGizmoTransformCommit(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  transform: ResolvedTransform
  baseTransform: ResolvedTransform
  currentFrame: number
}): {
  autoOps: AutoKeyframeOperation[]
  transformProps: Partial<TransformProperties>
  shouldUpdateBase: boolean
} {
  const propertyValues: Record<TransformAnimatableProperty, number> = {
    x: params.transform.x,
    y: params.transform.y,
    width: params.transform.width,
    height: params.transform.height,
    anchorX: params.transform.anchorX,
    anchorY: params.transform.anchorY,
    rotation: params.transform.rotation,
    opacity: params.transform.opacity,
    cornerRadius: params.transform.cornerRadius,
  }
  const autoKeyframedProps = new Set<TransformAnimatableProperty>()
  const autoOps: AutoKeyframeOperation[] = []

  const positionLane = params.itemKeyframes?.vectorProperties?.find(
    (lane) => lane.property === 'position' && lane.keyframes.length > 0,
  )
  if (positionLane) {
    const operation = getVectorAutoKeyframeOperation(
      params.item,
      params.itemKeyframes,
      'position',
      { x: params.transform.x, y: params.transform.y },
      params.currentFrame,
    )
    if (operation) {
      autoOps.push(operation)
      autoKeyframedProps.add('x')
      autoKeyframedProps.add('y')
    }
  }

  const scaleLane = params.itemKeyframes?.vectorProperties?.find(
    (lane) => lane.property === 'scale' && lane.keyframes.length > 0,
  )
  if (scaleLane) {
    const operation = getVectorAutoKeyframeOperation(
      params.item,
      params.itemKeyframes,
      'scale',
      {
        x:
          params.baseTransform.width === 0
            ? 100
            : (params.transform.width / params.baseTransform.width) * 100,
        y:
          params.baseTransform.height === 0
            ? 100
            : (params.transform.height / params.baseTransform.height) * 100,
      },
      params.currentFrame,
    )
    if (operation) {
      autoOps.push(operation)
      autoKeyframedProps.add('width')
      autoKeyframedProps.add('height')
    }
  }

  for (const property of SCALAR_GIZMO_PROPERTIES) {
    if (
      (positionLane && (property === 'x' || property === 'y')) ||
      (scaleLane && (property === 'width' || property === 'height'))
    ) {
      continue
    }
    const operation = getAutoKeyframeOperation(
      params.item,
      params.itemKeyframes,
      property,
      propertyValues[property],
      params.currentFrame,
    )
    if (!operation) continue
    autoOps.push(operation)
    autoKeyframedProps.add(property)
  }

  const transformProps: Partial<TransformProperties> = {
    cornerRadius: params.transform.cornerRadius,
  }
  for (const property of SCALAR_GIZMO_PROPERTIES) {
    if (!autoKeyframedProps.has(property)) transformProps[property] = params.transform[property]
  }

  return {
    autoOps,
    transformProps,
    shouldUpdateBase: Object.keys(transformProps).length > 1 || autoKeyframedProps.size === 0,
  }
}

export function buildGizmoAnchorCommit(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  transform: ResolvedTransform
  currentFrame: number
}): {
  autoOps: AutoKeyframeOperation[]
  transformProps: Partial<TransformProperties>
} {
  const values = {
    x: params.transform.x,
    y: params.transform.y,
    anchorX: params.transform.anchorX,
    anchorY: params.transform.anchorY,
  }
  const autoKeyframedProps = new Set<(typeof ANCHOR_GIZMO_PROPERTIES)[number]>()
  const autoOps: AutoKeyframeOperation[] = []

  for (const vectorProperty of ['position', 'anchor'] as const) {
    const lane = params.itemKeyframes?.vectorProperties?.find(
      (candidate) => candidate.property === vectorProperty && candidate.keyframes.length > 0,
    )
    if (!lane) continue
    const components =
      vectorProperty === 'position' ? (['x', 'y'] as const) : (['anchorX', 'anchorY'] as const)
    const operation = getVectorAutoKeyframeOperation(
      params.item,
      params.itemKeyframes,
      vectorProperty,
      { x: values[components[0]], y: values[components[1]] },
      params.currentFrame,
    )
    if (!operation) continue
    autoOps.push(operation)
    autoKeyframedProps.add(components[0])
    autoKeyframedProps.add(components[1])
  }

  for (const property of ANCHOR_GIZMO_PROPERTIES) {
    if (autoKeyframedProps.has(property)) continue
    const operation = getAutoKeyframeOperation(
      params.item,
      params.itemKeyframes,
      property,
      values[property],
      params.currentFrame,
    )
    if (!operation) continue
    autoOps.push(operation)
    autoKeyframedProps.add(property)
  }

  const transformProps: Partial<TransformProperties> = {}
  for (const property of ANCHOR_GIZMO_PROPERTIES) {
    if (!autoKeyframedProps.has(property)) transformProps[property] = values[property]
  }

  return { autoOps, transformProps }
}
