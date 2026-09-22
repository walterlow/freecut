import type { AnimatableProperty } from '@/types/keyframe'
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges'

interface PropertyValueScrubOptions {
  startValue: number
  deltaX: number
  decimals: number
  /** Value change per horizontal pixel before fine-control modifiers. */
  step?: number
  min?: number
  max?: number
  shiftKey?: boolean
  altKey?: boolean
}

export function getScrubbedPropertyValue({
  startValue,
  deltaX,
  decimals,
  step = 10 ** -decimals,
  min = -Infinity,
  max = Infinity,
  shiftKey = false,
  altKey = false,
}: PropertyValueScrubOptions): { value: number; display: string } {
  const modifier = altKey ? 0.01 : shiftKey ? 0.1 : 1
  const precision = Math.min(8, decimals + (altKey ? 2 : shiftKey ? 1 : 0))
  const unclamped = startValue + deltaX * step * modifier
  const clamped = Math.max(min, Math.min(max, unclamped))
  const value = Number(clamped.toFixed(precision))

  return { value, display: value.toFixed(precision) }
}

/** Identity fields shared by every in-progress value scrub. */
export interface ValueScrubPointer {
  property: AnimatableProperty
  pointerId: number
}

/** Whether a pointer event continues the in-progress scrub of `property`. */
export function matchesValueScrubPointer<T extends ValueScrubPointer>(
  scrub: T | null,
  event: { pointerId: number },
  property: AnimatableProperty,
): scrub is T {
  return scrub !== null && scrub.pointerId === event.pointerId && scrub.property === property
}

/** Next value/display for a scrub delta, using the property's own range policy. */
export function getPropertyScrubbedValue(
  property: AnimatableProperty,
  startValue: number,
  deltaX: number,
  modifiers: { shiftKey: boolean; altKey: boolean },
): { value: number; display: string } {
  const range = PROPERTY_VALUE_RANGES[property]
  return getScrubbedPropertyValue({
    startValue,
    deltaX,
    decimals: range?.decimals ?? 2,
    min: range?.min,
    max: range?.max,
    shiftKey: modifiers.shiftKey,
    altKey: modifiers.altKey,
  })
}
