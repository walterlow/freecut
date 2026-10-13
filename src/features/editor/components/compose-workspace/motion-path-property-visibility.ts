import {
  isPathVertexAnimatableProperty,
  parsePathVertexAnimatableProperty,
  type AnimatableProperty,
  type ItemKeyframes,
} from '@/types/keyframe'

interface MotionPathPropertyVisibilityOptions {
  itemKeyframes?: ItemKeyframes
  selectedVertexIndices?: readonly number[]
  showAllVertices?: boolean
  alwaysInclude?: AnimatableProperty | null
}

function getKeyedPathProperties(itemKeyframes: ItemKeyframes | undefined) {
  return new Set<AnimatableProperty>(
    (itemKeyframes?.properties ?? [])
      .filter(
        (entry) => entry.keyframes.length > 0 && isPathVertexAnimatableProperty(entry.property),
      )
      .map((entry) => entry.property),
  )
}

function getFocusedVertexIndices(
  selectedVertexIndices: readonly number[],
  hasVisiblePathProperties: boolean,
): ReadonlySet<number> {
  if (selectedVertexIndices.length > 0) return new Set(selectedVertexIndices)
  return hasVisiblePathProperties ? new Set() : new Set([0])
}

/**
 * Keeps the canonical property surface complete while bounding Motion's rows.
 * Existing animation is never hidden. An actively selected vertex is shown
 * next; a new, unanimated path falls back to Vertex 1 until canvas selection.
 */
export function getVisibleMotionPathProperties(
  properties: readonly AnimatableProperty[],
  {
    itemKeyframes,
    selectedVertexIndices = [],
    showAllVertices = false,
    alwaysInclude = null,
  }: MotionPathPropertyVisibilityOptions = {},
): AnimatableProperty[] {
  if (showAllVertices) return [...properties]

  const pathProperties = properties.filter(isPathVertexAnimatableProperty)
  if (pathProperties.length === 0) return [...properties]

  const visiblePathProperties = getKeyedPathProperties(itemKeyframes)
  if (alwaysInclude && isPathVertexAnimatableProperty(alwaysInclude)) {
    visiblePathProperties.add(alwaysInclude)
  }

  const selectedVertices = getFocusedVertexIndices(
    selectedVertexIndices,
    visiblePathProperties.size > 0,
  )
  for (const property of pathProperties) {
    const parsed = parsePathVertexAnimatableProperty(property)
    if (parsed && selectedVertices.has(parsed.vertexIndex)) {
      visiblePathProperties.add(property)
    }
  }

  return properties.filter(
    (property) => !isPathVertexAnimatableProperty(property) || visiblePathProperties.has(property),
  )
}
