/**
 * Dopesheet graph-pane display state.
 * Owns what the graph pane shows: the visible property list and its value
 * scale, which property's curve is drawn, and the keys the focused pane
 * claims. The decisions themselves live in dopesheet-graph-display; this hook
 * is the React wiring around them.
 */

import { useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils'
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges'
import {
  handleGraphPaneKeyDown as runGraphPaneKeyDown,
  resolveGraphDisplayProperty,
} from './dopesheet-graph-display'

export interface UseDopesheetGraphDisplayOptions {
  graphPaneRef: RefObject<HTMLDivElement | null>
  graphVisibleProperties: Set<AnimatableProperty>
  compoundSecondaryProperties: Partial<Record<AnimatableProperty, AnimatableProperty>>
  graphableProperties: AnimatableProperty[]
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  autoZoomGraphHeight: boolean
  activeSelectedProperty: AnimatableProperty | null
  isPropertyLocked: (property: AnimatableProperty) => boolean
  disabled: boolean
  selectedRefs: KeyframeRef[]
  nudgeSelectedKeyframes: (deltaFrames: number) => void
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
}

export interface UseDopesheetGraphDisplayReturn {
  visibleGraphProperties: AnimatableProperty[]
  verticalZoomRatioBase: number
  graphDisplayProperty: AnimatableProperty | null
  graphDisplayPropertyLocked: boolean
  focusGraphPane: () => void
  handleGraphPaneKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

export function useDopesheetGraphDisplay({
  graphPaneRef,
  graphVisibleProperties,
  compoundSecondaryProperties,
  graphableProperties,
  keyframesByProperty,
  autoZoomGraphHeight,
  activeSelectedProperty,
  isPropertyLocked,
  disabled,
  selectedRefs,
  nudgeSelectedKeyframes,
  onRemoveKeyframes,
}: UseDopesheetGraphDisplayOptions): UseDopesheetGraphDisplayReturn {
  const visibleGraphProperties = useMemo(() => {
    const properties = new Set(graphVisibleProperties)
    for (const property of graphVisibleProperties) {
      const secondary = compoundSecondaryProperties[property]
      if (secondary) properties.add(secondary)
    }
    return [...properties]
  }, [compoundSecondaryProperties, graphVisibleProperties])
  const graphBaseValueRange = useMemo(
    () =>
      getCombinedGraphValueRange(
        visibleGraphProperties.map((property) => PROPERTY_VALUE_RANGES[property] ?? null),
        visibleGraphProperties.map((property) => keyframesByProperty[property] ?? []),
        autoZoomGraphHeight,
      ),
    [autoZoomGraphHeight, keyframesByProperty, visibleGraphProperties],
  )
  const graphBaseValueSpan = useMemo(
    () => Math.max(0.0001, graphBaseValueRange.max - graphBaseValueRange.min),
    [graphBaseValueRange],
  )
  const graphMinZoomValueSpan = useMemo(
    () => Math.max(graphBaseValueSpan * 0.02, 0.0001),
    [graphBaseValueSpan],
  )
  const verticalZoomRatioBase = useMemo(
    () => Math.max(1, graphBaseValueSpan / graphMinZoomValueSpan),
    [graphBaseValueSpan, graphMinZoomValueSpan],
  )

  const graphDisplayProperty = useMemo(
    () =>
      resolveGraphDisplayProperty(
        graphVisibleProperties,
        graphableProperties,
        activeSelectedProperty,
      ),
    [activeSelectedProperty, graphVisibleProperties, graphableProperties],
  )
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false
  const focusGraphPane = useCallback(() => {
    // `preventScroll` is essential: focusing a tabIndex={-1} element inside a
    // scrollable container makes the browser scroll it into view. Without this,
    // pressing a keyframe (which focuses the pane via onPointerDownCapture)
    // shifts the entire dopesheet scroll.
    graphPaneRef.current?.focus({ preventScroll: true })
  }, [graphPaneRef])
  const handleGraphPaneKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      runGraphPaneKeyDown(event, {
        disabled,
        propertyLocked: graphDisplayPropertyLocked,
        selectedRefs,
        onRemoveKeyframes,
        onNudge: nudgeSelectedKeyframes,
      })
    },
    [disabled, graphDisplayPropertyLocked, nudgeSelectedKeyframes, onRemoveKeyframes, selectedRefs],
  )

  return {
    visibleGraphProperties,
    verticalZoomRatioBase,
    graphDisplayProperty,
    graphDisplayPropertyLocked,
    focusGraphPane,
    handleGraphPaneKeyDown,
  }
}
