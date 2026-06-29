/**
 * Graph view state hook.
 * Owns the curve visibility set (with localStorage persistence per item),
 * the ruler unit, the show-all-handles + auto-zoom toggles, and the
 * vertical zoom level. Also exposes the toggle callbacks for individual
 * property curves and group curve batches.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import {
  getDefaultGraphVisibleProperties,
  loadGraphVisibleProperties,
  saveGraphVisibleProperties,
} from './graph-visibility-storage'

interface UseGraphViewStateOptions {
  itemId: string
  availableProperties: AnimatableProperty[]
  /** Properties that actually have a drawable curve (>= 2 keyframes). */
  graphableProperties: AnimatableProperty[]
  selectedProperty: AnimatableProperty | null
  onPropertyChange?: (property: AnimatableProperty | null) => void
  onActivePropertyChange?: (property: AnimatableProperty) => void
}

export interface UseGraphViewStateReturn {
  graphVisibleProperties: Set<AnimatableProperty>
  setGraphVisibleProperties: React.Dispatch<React.SetStateAction<Set<AnimatableProperty>>>
  graphRulerUnit: 'frames' | 'seconds'
  setGraphRulerUnit: React.Dispatch<React.SetStateAction<'frames' | 'seconds'>>
  showAllGraphHandles: boolean
  setShowAllGraphHandles: React.Dispatch<React.SetStateAction<boolean>>
  autoZoomGraphHeight: boolean
  setAutoZoomGraphHeight: React.Dispatch<React.SetStateAction<boolean>>
  graphVerticalZoomValue: number
  setGraphVerticalZoomValue: React.Dispatch<React.SetStateAction<number>>
  togglePropertyCurve: (property: AnimatableProperty) => void
  toggleGroupCurves: (properties: AnimatableProperty[]) => void
}

export function useGraphViewState({
  itemId,
  availableProperties,
  graphableProperties,
  selectedProperty,
  onPropertyChange,
  onActivePropertyChange,
}: UseGraphViewStateOptions): UseGraphViewStateReturn {
  const skipNextSaveRef = useRef(false)
  const selectedPropertyRef = useRef<AnimatableProperty | null>(selectedProperty)
  const prevItemIdRef = useRef(itemId)
  const prevGraphableRef = useRef(graphableProperties)

  const [graphRulerUnit, setGraphRulerUnit] = useState<'frames' | 'seconds'>('frames')
  const [showAllGraphHandles, setShowAllGraphHandles] = useState(false)
  const [autoZoomGraphHeight, setAutoZoomGraphHeight] = useState(true)
  const [graphVerticalZoomValue, setGraphVerticalZoomValue] = useState(0)
  const [graphVisibleProperties, setGraphVisibleProperties] = useState<Set<AnimatableProperty>>(
    () => loadGraphVisibleProperties(itemId, availableProperties, selectedProperty, graphableProperties),
  )

  // Keep the visible-curve set in sync as the clip or its keyframed properties
  // change. The refs snapshot selection/graphable lists so this only re-runs on
  // clip or available-property changes.
  useEffect(() => {
    if (prevItemIdRef.current !== itemId) {
      // Switched clip: restore that clip's saved curves.
      prevItemIdRef.current = itemId
      prevGraphableRef.current = graphableProperties
      skipNextSaveRef.current = true
      setGraphVisibleProperties(
        loadGraphVisibleProperties(
          itemId,
          availableProperties,
          selectedPropertyRef.current,
          graphableProperties,
        ),
      )
      return
    }

    // Same clip, but its drawable curves changed (e.g. a preset just added
    // keyframes). We key off GRAPHABLE properties (>= 2 keyframes), not merely
    // "available" ones — `keyframesByProperty` carries empty entries for every
    // property, so availability never changes when a preset animates one.
    const prevGraphable = prevGraphableRef.current
    prevGraphableRef.current = graphableProperties
    const newlyGraphable = graphableProperties.filter((property) => !prevGraphable.includes(property))

    setGraphVisibleProperties((prev) => {
      const available = new Set(availableProperties)
      const graphable = new Set(graphableProperties)
      const next = new Set([...prev].filter((property) => available.has(property)))
      // Reveal curves that just became drawable (the preset's properties).
      for (const property of newlyGraphable) next.add(property)
      // If no drawable curve is shown but the clip has some, fall back to a
      // default so the graph isn't blank. Toggling a curve off doesn't change
      // `graphableProperties`, so an intentional hide-all is left alone.
      const showsAGraphable = [...next].some((property) => graphable.has(property))
      if (!showsAGraphable && graphableProperties.length > 0) {
        return getDefaultGraphVisibleProperties(
          availableProperties,
          selectedPropertyRef.current,
          graphableProperties,
        )
      }
      const unchanged = next.size === prev.size && [...next].every((property) => prev.has(property))
      return unchanged ? prev : next
    })
  }, [itemId, availableProperties, graphableProperties])

  useEffect(() => {
    selectedPropertyRef.current = selectedProperty
  }, [selectedProperty])

  // Persist visible curves whenever they change (skip the restore-driven update).
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }

    saveGraphVisibleProperties(itemId, graphVisibleProperties)
  }, [graphVisibleProperties, itemId])

  // Reset vertical zoom when the clip changes or auto-zoom mode toggles
  useEffect(() => {
    setGraphVerticalZoomValue(0)
  }, [itemId, autoZoomGraphHeight])

  const togglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties((prev) => {
        const next = new Set(prev)
        if (next.has(property)) {
          next.delete(property)
        } else {
          next.add(property)
        }
        // Set primary to this property when toggling on
        if (next.has(property)) {
          onPropertyChange?.(property)
          onActivePropertyChange?.(property)
        } else if (next.size > 0) {
          // Switch primary to first remaining visible
          const first = [...next][0]!
          onPropertyChange?.(first)
          onActivePropertyChange?.(first)
        }
        return next
      })
    },
    [onActivePropertyChange, onPropertyChange],
  )

  const toggleGroupCurves = useCallback(
    (properties: AnimatableProperty[]) => {
      if (properties.length === 0) return
      setGraphVisibleProperties((prev) => {
        const anyVisible = properties.some((p) => prev.has(p))
        const next = new Set(prev)
        if (anyVisible) {
          // Turn all off
          for (const p of properties) next.delete(p)
          if (next.size > 0) {
            const first = [...next][0]!
            onPropertyChange?.(first)
            onActivePropertyChange?.(first)
          }
        } else {
          // Turn all on
          for (const p of properties) next.add(p)
          onPropertyChange?.(properties[0]!)
          onActivePropertyChange?.(properties[0]!)
        }
        return next
      })
    },
    [onActivePropertyChange, onPropertyChange],
  )

  return {
    graphVisibleProperties,
    setGraphVisibleProperties,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    graphVerticalZoomValue,
    setGraphVerticalZoomValue,
    togglePropertyCurve,
    toggleGroupCurves,
  }
}
