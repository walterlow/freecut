import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import { getDirectPropertyLinks } from '@/types/keyframe'

export function hasEditableKeyframes(itemKeyframes: ItemKeyframes | null | undefined): boolean {
  if (!itemKeyframes) return false

  return (
    itemKeyframes.properties.some((entry) => entry.keyframes.length > 0) ||
    (itemKeyframes.vectorProperties ?? []).some((entry) => entry.keyframes.length > 0)
  )
}

function scalarTimingsMatch(first: readonly Keyframe[], second: readonly Keyframe[]): boolean {
  if (first.length !== second.length) return false
  return first.every(
    (keyframe, index) =>
      keyframe.frame === second[index]?.frame &&
      keyframe.easing === second[index]?.easing &&
      JSON.stringify(keyframe.easingConfig ?? null) ===
        JSON.stringify(second[index]?.easingConfig ?? null),
  )
}

/**
 * Edit treats Position as one coupled lane unless the project explicitly
 * separated it or existing X/Y authoring cannot be represented by one shared
 * timing lane. A legacy one-axis preset is therefore presented as Position,
 * not as two duplicate diamonds.
 */
export function shouldShowSeparatedPosition(
  itemKeyframes: ItemKeyframes | null | undefined,
): boolean {
  if (!itemKeyframes) return false
  if (itemKeyframes.separatedVectorProperties?.includes('position')) return true

  if (
    getDirectPropertyLinks(itemKeyframes).some(
      (link) => link.targetProperty === 'x' || link.targetProperty === 'y',
    ) ||
    itemKeyframes.expressions?.some(
      (expression) =>
        expression.type === 'expression' &&
        (expression.targetProperty === 'x' || expression.targetProperty === 'y'),
    )
  ) {
    return true
  }

  const x = itemKeyframes.properties.find((property) => property.property === 'x')?.keyframes ?? []
  const y = itemKeyframes.properties.find((property) => property.property === 'y')?.keyframes ?? []
  if (x.length === 0 || y.length === 0) return false
  return !scalarTimingsMatch(x, y)
}

/** Behavioral counterpart to the separated-row UI. */
export function isVectorPropertySeparated(
  itemKeyframes: ItemKeyframes | null | undefined,
  property: VectorAnimatableProperty,
): boolean {
  if (property === 'position') return shouldShowSeparatedPosition(itemKeyframes)
  return itemKeyframes?.separatedVectorProperties?.includes(property) ?? false
}

/** Resolve the IDs and values shown by one scalar editor lane. */
export function resolveEditorScalarLane(
  itemKeyframes: ItemKeyframes | null | undefined,
  vectorProperty: VectorAnimatableProperty,
  scalarProperty: AnimatableProperty,
  axis: 'x' | 'y',
  vectorKeyframes: readonly VectorKeyframe[],
): Keyframe[] {
  if (isVectorPropertySeparated(itemKeyframes, vectorProperty)) {
    return (
      itemKeyframes?.properties.find((property) => property.property === scalarProperty)
        ?.keyframes ?? []
    )
  }

  return vectorKeyframes.map((keyframe) => ({
    ...keyframe,
    id: axis === 'y' ? `${keyframe.id}:y` : keyframe.id,
    value: keyframe.value[axis],
    spatial: undefined,
    temporalEase: undefined,
  }))
}
