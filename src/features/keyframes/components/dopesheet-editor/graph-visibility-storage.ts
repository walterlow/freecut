import type { AnimatableProperty } from '@/types/keyframe'
import { GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY } from './dopesheet-constants'

/**
 * Pick the default visible curve. Prefers a property that actually has a curve
 * to draw (>= 2 keyframes, listed in `graphableProperties`) so the graph is not
 * blank just because the selected/first property has a single keyframe.
 */
export function getDefaultGraphVisibleProperties(
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined,
  graphableProperties: AnimatableProperty[] = properties,
): Set<AnimatableProperty> {
  // Honour the selection when it has a drawable curve.
  if (
    selectedProperty &&
    properties.includes(selectedProperty) &&
    graphableProperties.includes(selectedProperty)
  ) {
    return new Set([selectedProperty])
  }

  // Otherwise the first property with a real curve.
  const firstGraphable = graphableProperties.find((property) => properties.includes(property))
  if (firstGraphable) {
    return new Set([firstGraphable])
  }

  // Fall back to the selection / first property even without a full curve.
  if (selectedProperty && properties.includes(selectedProperty)) {
    return new Set([selectedProperty])
  }
  const firstProperty = properties[0]
  return firstProperty ? new Set([firstProperty]) : new Set()
}

export function loadGraphVisibleProperties(
  itemId: string,
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined,
  graphableProperties: AnimatableProperty[] = properties,
): Set<AnimatableProperty> {
  const fallback = getDefaultGraphVisibleProperties(properties, selectedProperty, graphableProperties)

  try {
    const raw = localStorage.getItem(`${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return fallback
    }

    const normalized = parsed.filter(
      (property): property is AnimatableProperty =>
        typeof property === 'string' && properties.includes(property as AnimatableProperty),
    )

    // Fall back to a default curve when the stored set is empty/stale, or when it
    // contains only properties that have no drawable curve (e.g. a leftover ["x"]
    // while the real animation is on width/height) — otherwise the graph reads as
    // blank for an animated clip.
    const graphable = new Set(graphableProperties)
    const showsAGraphable = normalized.some((property) => graphable.has(property))
    if (normalized.length === 0 || (graphableProperties.length > 0 && !showsAGraphable)) {
      return fallback
    }
    return new Set(normalized)
  } catch {
    return fallback
  }
}

export function saveGraphVisibleProperties(itemId: string, properties: Set<AnimatableProperty>) {
  try {
    localStorage.setItem(
      `${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`,
      JSON.stringify([...properties]),
    )
  } catch {
    // ignore localStorage write errors
  }
}
