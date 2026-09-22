import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from 'react'
import type { TFunction } from 'i18next'
import { cn } from '@/shared/ui/cn'
import {
  isEffectAnimatableProperty,
  isLinkableAnimatableProperty,
  type AnimatableProperty,
  type DirectLinkableProperty,
  type PropertyExpression,
} from '@/types/keyframe'
import {
  evaluatePropertyExpression,
  isExpressionValueCompatible,
  type ExpressionValue,
} from '@/features/keyframes/utils/property-expression'
import {
  getKeyframePropertyLabel,
  getKeyframePropertyShortLabel,
} from '@/features/keyframes/utils/property-i18n'
import {
  isColorAnimatableProperty,
  PROPERTY_VALUE_RANGES,
} from '@/features/keyframes/property-value-ranges'
import { colorStringToKeyframeValue } from '@/features/keyframes/utils/color-keyframes'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'

/** The expression editor draft when it targets the given linkable property. */
export interface PropertyRowExpressionEditor {
  property: DirectLinkableProperty
  source: string
}

/** Numeric input range policy: colors are free-text, others clamp to their range. */
export function resolveNumericInputRange(property: AnimatableProperty): {
  step: number | undefined
  min: number | undefined
  max: number | undefined
} {
  if (isColorAnimatableProperty(property))
    return { step: undefined, min: undefined, max: undefined }
  const range = PROPERTY_VALUE_RANGES[property]
  return {
    step: (range?.decimals ?? 2) === 0 ? 1 : 0.1,
    min: range?.min,
    max: range?.max,
  }
}

export interface RowValueInputKeyDownArgs {
  property: AnimatableProperty
  propertyValues: Partial<Record<AnimatableProperty, number>>
  skipNextBlurCommitPropertyRef: RefObject<AnimatableProperty | null>
  onValueCommit: (property: AnimatableProperty, options?: { allowCreate?: boolean }) => void
  onEditingChange: Dispatch<SetStateAction<AnimatableProperty | null>>
  onDraftsChange: Dispatch<SetStateAction<Partial<Record<AnimatableProperty, string>>>>
  formatDisplayValue: (property: AnimatableProperty, value: number | undefined) => string
}

/** Enter commits the draft; Escape restores the formatted base value. */
export function handleRowValueInputKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  {
    property,
    propertyValues,
    skipNextBlurCommitPropertyRef,
    onValueCommit,
    onEditingChange,
    onDraftsChange,
    formatDisplayValue,
  }: RowValueInputKeyDownArgs,
): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    skipNextBlurCommitPropertyRef.current = property
    onValueCommit(property, { allowCreate: true })
    onEditingChange((current) => (current === property ? null : current))
    event.currentTarget.blur()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    skipNextBlurCommitPropertyRef.current = property
    onDraftsChange((prev) => ({
      ...prev,
      [property]: formatDisplayValue(property, propertyValues[property]),
    }))
    onEditingChange((current) => (current === property ? null : current))
    event.currentTarget.blur()
  }
}

export interface PropertyRowShellClassArgs {
  isLanes: boolean
  rowOptions: { classic?: boolean; indented?: boolean } | undefined
  hasKeyframeAtCurrentFrame: boolean
  showGraphPane: boolean
  selectedProperty: AnimatableProperty | null
  property: AnimatableProperty
  graphProperties: ReadonlySet<AnimatableProperty>
  rowLocked: boolean
}

/** Root class list for a dopesheet property row. */
export function resolvePropertyRowShellClassName({
  isLanes,
  rowOptions,
  hasKeyframeAtCurrentFrame,
  showGraphPane,
  selectedProperty,
  property,
  graphProperties,
  rowLocked,
}: PropertyRowShellClassArgs): string {
  const indented = rowOptions?.indented ?? false
  return cn(
    'group h-full px-1 flex items-center gap-px bg-muted/8',
    // Motion lanes sit beneath a layer row, so preserve that outer tree
    // level before applying the existing property-group indentation.
    isLanes &&
      "relative before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/40 before:content-['']",
    isLanes ? (indented ? 'pl-9' : 'pl-4') : indented && 'pl-6',
    hasKeyframeAtCurrentFrame && (isLanes ? 'bg-accent/70' : 'bg-primary/10'),
    showGraphPane && graphProperties.has(property) && 'bg-accent/40',
    selectedProperty === property && 'bg-accent/55',
    !rowLocked && 'cursor-pointer',
    rowLocked && 'opacity-70',
    'data-[expression-link-eligible=true]:bg-primary/[0.06] data-[expression-link-eligible=true]:ring-1 data-[expression-link-eligible=true]:ring-inset data-[expression-link-eligible=true]:ring-primary/20',
    'data-[expression-link-hover=true]:!bg-primary/20 data-[expression-link-hover=true]:ring-1 data-[expression-link-hover=true]:ring-inset data-[expression-link-hover=true]:!ring-primary/70',
    'data-[expression-reference-hover=true]:bg-sky-500/15 data-[expression-reference-hover=true]:ring-1 data-[expression-reference-hover=true]:ring-inset data-[expression-reference-hover=true]:ring-sky-400/70',
    'data-[expression-reference-pickable=true]:cursor-crosshair data-[expression-reference-pickable=true]:bg-sky-500/15 data-[expression-reference-pickable=true]:ring-1 data-[expression-reference-pickable=true]:ring-inset data-[expression-reference-pickable=true]:ring-sky-400/70',
    'data-[expression-reference-unavailable=true]:opacity-45',
  )
}

/** Display labels for a property row. */
export function resolvePropertyRowLabels(
  property: AnimatableProperty,
  propertyLabels: Partial<Record<AnimatableProperty, string>>,
  compoundRow: CompoundPropertyInputConfig | undefined,
  t: TFunction,
): { rowLabel: string; rowDisplayLabel: string } {
  const compoundLabel = compoundRow?.label
  return {
    rowLabel: propertyLabels[property] ?? compoundLabel ?? getKeyframePropertyLabel(t, property),
    rowDisplayLabel:
      propertyLabels[property] ?? compoundLabel ?? getKeyframePropertyShortLabel(t, property),
  }
}

/** Parse a row's raw value draft into a finite value clamped to its range. */
export function resolvePropertyDraftValue(
  property: AnimatableProperty,
  draft: string | undefined,
): number | null {
  const parsed = isColorAnimatableProperty(property)
    ? colorStringToKeyframeValue(draft ?? '')
    : Number(draft)
  if (parsed === null || !Number.isFinite(parsed)) return null
  const range = PROPERTY_VALUE_RANGES[property]
  if (!range) return parsed
  return Math.max(range.min, Math.min(range.max, parsed))
}

/** Linkable property for a row: compound override or the property itself. */
export function resolvePropertyRowLinkable(
  property: AnimatableProperty,
  compoundRow: CompoundPropertyInputConfig | undefined,
): DirectLinkableProperty | null {
  return compoundRow?.linkProperty ?? (isLinkableAnimatableProperty(property) ? property : null)
}

/** Pre-expression value feeding the expression preview evaluator. */
export function resolvePropertyRowPreExpressionValue(
  property: AnimatableProperty,
  compoundRow: CompoundPropertyInputConfig | undefined,
  preExpressionPropertyValues: Partial<Record<AnimatableProperty, number>>,
  propertyValues: Partial<Record<AnimatableProperty, number>>,
): ExpressionValue | undefined {
  return compoundRow
    ? (compoundRow.preExpressionValue ?? compoundRow.value)
    : (preExpressionPropertyValues[property] ?? propertyValues[property])
}

export interface PropertyRowExpressionErrorArgs {
  linkableProperty: DirectLinkableProperty | null
  preExpressionValue: ExpressionValue | undefined
  expressionEditor: PropertyRowExpressionEditor | null
  propertyExpression: PropertyExpression | undefined
  globalFrame: number | null | undefined
  itemFrom: number
  currentFrame: number
  fps: number
  resolveExpressionReference?: (
    itemId: string,
    property: DirectLinkableProperty,
  ) => ExpressionValue | null
}

/** Type-compatibility error for a row's live expression preview, if any. */
export function resolvePropertyRowExpressionError({
  linkableProperty,
  preExpressionValue,
  expressionEditor,
  propertyExpression,
  globalFrame,
  itemFrom,
  currentFrame,
  fps,
  resolveExpressionReference,
}: PropertyRowExpressionErrorArgs): string | undefined {
  const editedExpression =
    linkableProperty && expressionEditor?.property === linkableProperty ? expressionEditor : null
  const preview =
    linkableProperty && preExpressionValue !== undefined && (editedExpression || propertyExpression)
      ? evaluatePropertyExpression(
          editedExpression?.source ?? propertyExpression?.source ?? 'value',
          {
            preValue: preExpressionValue,
            globalFrame: globalFrame ?? itemFrom + currentFrame,
            fps,
            resolveProperty: (sourceItemId, sourceProperty) =>
              resolveExpressionReference?.(sourceItemId, sourceProperty) ?? null,
          },
        )
      : undefined
  return (
    preview?.error ??
    (linkableProperty && preview && !isExpressionValueCompatible(linkableProperty, preview.value)
      ? 'Expression result has the wrong value type'
      : undefined)
  )
}

export interface PropertyRowResetStateArgs {
  property: AnimatableProperty
  rowLabel: string
  hasResetToDefault: boolean
  disabled: boolean
  rowLocked: boolean
  canClear: boolean
  t: TFunction
}

/** Reset-button visibility, style source, and label for a property row. */
export function resolvePropertyRowResetState({
  property,
  rowLabel,
  hasResetToDefault,
  disabled,
  rowLocked,
  canClear,
  t,
}: PropertyRowResetStateArgs): {
  canResetEffectProperty: boolean
  canResetRow: boolean
  resetRowLabel: string
} {
  const canResetEffectProperty =
    isEffectAnimatableProperty(property) && hasResetToDefault && !disabled && !rowLocked
  const canResetRow = canResetEffectProperty || canClear
  const resetRowLabel = t(
    canResetEffectProperty
      ? 'timeline.keyframeEditor.resetEffectPropertyDefault'
      : 'timeline.keyframeEditor.resetPropertyAnimation',
    {
      property: rowLabel,
      defaultValue: canResetEffectProperty
        ? `Reset ${rowLabel} to its default value`
        : `Reset ${rowLabel} animation to its base value`,
    },
  )
  return { canResetEffectProperty, canResetRow, resetRowLabel }
}
