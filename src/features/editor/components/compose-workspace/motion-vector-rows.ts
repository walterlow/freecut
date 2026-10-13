import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  PropertyKeyframes,
  TransformAnimatableProperty,
  VectorAnimatableProperty,
  VectorKeyframe,
  VectorPropertyKeyframes,
} from '@/types/keyframe'
import { getDirectPropertyLinks } from '@/types/keyframe'
import type { ResolvedTransform } from '@/types/transform'

export interface MotionVectorRowDefinition {
  property: VectorAnimatableProperty
  primary: TransformAnimatableProperty
  secondary: TransformAnimatableProperty
  label: string
  unit: string
}

export const MOTION_VECTOR_ROW_DEFINITIONS: readonly MotionVectorRowDefinition[] = [
  { property: 'position', primary: 'x', secondary: 'y', label: 'Position', unit: 'px' },
  { property: 'scale', primary: 'width', secondary: 'height', label: 'Scale', unit: '%' },
  { property: 'anchor', primary: 'anchorX', secondary: 'anchorY', label: 'Anchor', unit: 'px' },
]

export function getMotionVectorProxy(property: AnimatableProperty): {
  property: VectorAnimatableProperty
  axis: 'x' | 'y'
} | null {
  for (const row of MOTION_VECTOR_ROW_DEFINITIONS) {
    if (property === row.primary) return { property: row.property, axis: 'x' }
    if (property === row.secondary) return { property: row.property, axis: 'y' }
  }
  return null
}

export function getStoredMotionVectorKeyframeId(keyframeId: string, axis: 'x' | 'y'): string {
  return axis === 'y' && keyframeId.endsWith(':y') ? keyframeId.slice(0, -2) : keyframeId
}

function getEditorMotionVectorKeyframeId(keyframeId: string, axis: 'x' | 'y'): string {
  return axis === 'y' ? `${keyframeId}:y` : keyframeId
}

function hasScalarAuthoring(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  if (!itemKeyframes) return false
  const scalarProperties = new Set<AnimatableProperty>([row.primary, row.secondary])
  const hasScalarKeys = itemKeyframes.properties.some(
    (entry) => scalarProperties.has(entry.property) && entry.keyframes.length > 0,
  )
  const hasScalarLink = getDirectPropertyLinks(itemKeyframes).some((link) =>
    scalarProperties.has(link.targetProperty as AnimatableProperty),
  )
  const hasScalarExpression = itemKeyframes.expressions?.some(
    (expression) =>
      expression.type === 'expression' &&
      scalarProperties.has(expression.targetProperty as AnimatableProperty),
  )
  return hasScalarKeys || hasScalarLink || Boolean(hasScalarExpression)
}

/**
 * Motion defaults to coupled transform rows. Existing component-level authoring
 * remains separated until the user explicitly migrates it, so legacy projects
 * never lose an axis-specific link, expression, or timing lane.
 */
export function shouldUseMotionVectorRow(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  return !isMotionVectorRowSeparated(itemKeyframes, row)
}

export function isMotionVectorRowSeparated(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  if (itemKeyframes?.separatedVectorProperties?.includes(row.property)) return true
  return hasScalarAuthoring(itemKeyframes, row)
}

function easingConfigsMatch(left: Keyframe, right: Keyframe): boolean {
  return JSON.stringify(left.easingConfig ?? null) === JSON.stringify(right.easingConfig ?? null)
}

/** A shared vector timing curve can exactly represent these scalar lanes. */
export function canCombineMotionVectorRowWithoutBake(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  const first =
    itemKeyframes?.properties.find((candidate) => candidate.property === row.primary)?.keyframes ??
    []
  const second =
    itemKeyframes?.properties.find((candidate) => candidate.property === row.secondary)
      ?.keyframes ?? []
  if (first.length === 0 || second.length === 0) return true
  return (
    first.length === second.length &&
    first.every(
      (keyframe, index) =>
        keyframe.frame === second[index]?.frame &&
        keyframe.easing === second[index]?.easing &&
        easingConfigsMatch(keyframe, second[index]!),
    )
  )
}

export function motionVectorSeparationNeedsBake(
  vectorProperty: VectorPropertyKeyframes | undefined,
): boolean {
  return Boolean(
    vectorProperty?.keyframes.some((keyframe) => keyframe.temporalEase || keyframe.spatial),
  )
}

function getSeparatedScalarValue(
  row: MotionVectorRowDefinition,
  axis: 'x' | 'y',
  value: VectorKeyframe['value'],
  baseTransform: ResolvedTransform,
): number {
  if (row.property !== 'scale') return value[axis]
  const base = axis === 'x' ? baseTransform.width : baseTransform.height
  return (base * value[axis]) / 100
}

export function buildMotionVectorSeparationProperties({
  row,
  vectorProperty,
  baseTransform,
  createId = () => crypto.randomUUID(),
}: {
  row: MotionVectorRowDefinition
  vectorProperty: VectorPropertyKeyframes | undefined
  baseTransform: ResolvedTransform
  createId?: () => string
}): PropertyKeyframes[] {
  if (!vectorProperty || vectorProperty.keyframes.length === 0) return []
  return (
    [
      [row.primary, 'x'],
      [row.secondary, 'y'],
    ] as const
  ).map(([property, axis]) => ({
    property,
    keyframes: vectorProperty.keyframes.map((keyframe) => ({
      id: createId(),
      frame: keyframe.frame,
      value: getSeparatedScalarValue(row, axis, keyframe.value, baseTransform),
      easing: keyframe.easing,
      easingConfig: keyframe.easingConfig,
      source: keyframe.source,
    })),
  }))
}

export function toMotionVectorProxyKeyframes(
  keyframes: readonly VectorKeyframe[],
  axis: 'x' | 'y',
): Keyframe[] {
  return keyframes.map((keyframe) => ({
    ...keyframe,
    id: getEditorMotionVectorKeyframeId(keyframe.id, axis),
    value: keyframe.value[axis],
    spatial: undefined,
    temporalEase: undefined,
  }))
}
