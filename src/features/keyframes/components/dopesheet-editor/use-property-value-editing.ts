/**
 * Dopesheet property value editing hook.
 * Owns the row value drafts (their text state, the sync effect that mirrors
 * committed values into them) and the drag-scrub lifecycle for numeric value
 * inputs: start, move, end, cancel. The component keeps the row inputs'
 * presentation and only receives these handlers plus the draft state the rows
 * render from.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import { DRAG_THRESHOLD } from './dopesheet-constants'
import { setPointerCaptureSafely } from './dopesheet-utils'
import { isColorAnimatableProperty } from '@/features/keyframes/property-value-ranges'
import { resolvePropertyDraftValue } from './property-row-view-model'
import {
  getPropertyScrubbedValue,
  matchesValueScrubPointer,
  type ValueScrubPointer,
} from './property-value-scrub'
import type { AnimatableProperty } from '@/types/keyframe'

interface ValueScrubState extends ValueScrubPointer {
  startX: number
  startValue: number
  lastValue: number
  lastDisplay: string
  didDrag: boolean
}

export interface UsePropertyValueEditingOptions {
  /** Properties currently shown in the value column, in column order. */
  propertyColumnProperties: AnimatableProperty[]
  propertyValues: Partial<Record<AnimatableProperty, number>>
  formatPropertyValue: (property: AnimatableProperty, value: number | undefined) => string
  isPropertyLocked: (property: AnimatableProperty) => boolean
  activateProperty: (property: AnimatableProperty) => void
  onPropertyValueCommit?: (
    property: AnimatableProperty,
    value: number,
    options?: { allowCreate?: boolean },
  ) => void
  onPropertyValuePreview?: (property: AnimatableProperty, value: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragCancel?: () => void
}

export interface UsePropertyValueEditingReturn {
  valueDrafts: Partial<Record<AnimatableProperty, string>>
  setValueDrafts: Dispatch<SetStateAction<Partial<Record<AnimatableProperty, string>>>>
  setEditingValueProperty: Dispatch<SetStateAction<AnimatableProperty | null>>
  valueDraftAtFocusRef: RefObject<Partial<Record<AnimatableProperty, string>>>
  skipNextBlurCommitPropertyRef: RefObject<AnimatableProperty | null>
  handleRowValueChange: (property: AnimatableProperty, value: string) => void
  handleRowValueCommit: (
    property: AnimatableProperty,
    options?: { allowCreate?: boolean },
  ) => void
  handleValueScrubStart: (
    event: ReactPointerEvent<HTMLInputElement>,
    property: AnimatableProperty,
  ) => void
  handleValueScrubMove: (
    event: ReactPointerEvent<HTMLInputElement>,
    property: AnimatableProperty,
  ) => void
  handleValueScrubEnd: (
    event: ReactPointerEvent<HTMLInputElement>,
    property: AnimatableProperty,
  ) => void
  handleValueScrubCancel: (
    event: ReactPointerEvent<HTMLInputElement>,
    property: AnimatableProperty,
  ) => void
}

export function usePropertyValueEditing({
  propertyColumnProperties,
  propertyValues,
  formatPropertyValue,
  isPropertyLocked,
  activateProperty,
  onPropertyValueCommit,
  onPropertyValuePreview,
  onDragStart,
  onDragEnd,
  onDragCancel,
}: UsePropertyValueEditingOptions): UsePropertyValueEditingReturn {
  const [valueDrafts, setValueDrafts] = useState<Partial<Record<AnimatableProperty, string>>>({})
  const [editingValueProperty, setEditingValueProperty] = useState<AnimatableProperty | null>(null)
  const skipNextBlurCommitPropertyRef = useRef<AnimatableProperty | null>(null)
  const valueDraftAtFocusRef = useRef<Partial<Record<AnimatableProperty, string>>>({})
  const valueScrubRef = useRef<ValueScrubState | null>(null)

  useEffect(() => {
    setValueDrafts((prev) => {
      let changed = false
      const nextDrafts = { ...prev }

      for (const property of propertyColumnProperties) {
        if (editingValueProperty === property) continue
        const nextValue = formatPropertyValue(property, propertyValues[property])
        if (nextDrafts[property] !== nextValue) {
          nextDrafts[property] = nextValue
          changed = true
        }
      }

      return changed ? nextDrafts : prev
    })
  }, [propertyColumnProperties, propertyValues, editingValueProperty, formatPropertyValue])

  const handleRowValueChange = useCallback((property: AnimatableProperty, value: string) => {
    setValueDrafts((prev) => ({ ...prev, [property]: value }))
  }, [])

  const handleRowValueCommit = useCallback(
    (property: AnimatableProperty, options?: { allowCreate?: boolean }) => {
      if (isPropertyLocked(property)) return
      const value = resolvePropertyDraftValue(property, valueDrafts[property])

      if (value === null) {
        setValueDrafts((prev) => ({
          ...prev,
          [property]: formatPropertyValue(property, propertyValues[property]),
        }))
        return
      }

      onPropertyValueCommit?.(property, value, options)
      setValueDrafts((prev) => ({
        ...prev,
        [property]: formatPropertyValue(property, value),
      }))
    },
    [formatPropertyValue, isPropertyLocked, onPropertyValueCommit, propertyValues, valueDrafts],
  )

  const handleValueScrubStart = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      if (event.button !== 0 || isColorAnimatableProperty(property)) return
      const startValue = Number(valueDrafts[property] ?? propertyValues[property])
      if (!Number.isFinite(startValue)) return

      valueScrubRef.current = {
        property,
        pointerId: event.pointerId,
        startX: event.clientX,
        startValue,
        lastValue: startValue,
        lastDisplay: String(startValue),
        didDrag: false,
      }
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [propertyValues, valueDrafts],
  )

  const handleValueScrubMove = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      const scrub = valueScrubRef.current
      if (!matchesValueScrubPointer(scrub, event, property)) return
      const deltaX = event.clientX - scrub.startX
      if (!scrub.didDrag && Math.abs(deltaX) < DRAG_THRESHOLD) return

      if (!scrub.didDrag) {
        scrub.didDrag = true
        activateProperty(property)
        onDragStart?.()
      }

      event.preventDefault()
      const next = getPropertyScrubbedValue(property, scrub.startValue, deltaX, event)
      scrub.lastValue = next.value
      scrub.lastDisplay = next.display
      setValueDrafts((previous) => ({ ...previous, [property]: next.display }))
      onPropertyValuePreview?.(property, next.value)
    },
    [activateProperty, onDragStart, onPropertyValuePreview],
  )

  const handleValueScrubEnd = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      const scrub = valueScrubRef.current
      if (!matchesValueScrubPointer(scrub, event, property)) return
      valueScrubRef.current = null
      if (!scrub.didDrag) return

      event.preventDefault()
      valueDraftAtFocusRef.current[property] = scrub.lastDisplay
      if (onPropertyValuePreview) {
        onDragEnd?.()
      } else {
        onPropertyValueCommit?.(property, scrub.lastValue, {
          allowCreate: true,
        })
      }
    },
    [onDragEnd, onPropertyValueCommit, onPropertyValuePreview],
  )

  const handleValueScrubCancel = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      const scrub = valueScrubRef.current
      if (!matchesValueScrubPointer(scrub, event, property)) return
      valueScrubRef.current = null
      if (!scrub.didDrag) return

      event.preventDefault()
      const restoredDisplay = formatPropertyValue(property, scrub.startValue)
      valueDraftAtFocusRef.current[property] = restoredDisplay
      setValueDrafts((previous) => ({ ...previous, [property]: restoredDisplay }))
      onDragCancel?.()
    },
    [formatPropertyValue, onDragCancel],
  )

  return {
    valueDrafts,
    setValueDrafts,
    setEditingValueProperty,
    valueDraftAtFocusRef,
    skipNextBlurCommitPropertyRef,
    handleRowValueChange,
    handleRowValueCommit,
    handleValueScrubStart,
    handleValueScrubMove,
    handleValueScrubEnd,
    handleValueScrubCancel,
  }
}
