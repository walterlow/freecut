import {
  isLinkableAnimatableProperty,
  type AnimatableProperty,
  type DirectLinkableProperty,
  type PropertyExpression,
} from '@/types/keyframe'
import {
  evaluatePropertyExpression,
  isExpressionValueCompatible,
  type ExpressionValue,
  type PropertyExpressionResult,
} from '@/features/keyframes/utils/property-expression'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import type { DopesheetPropertyRow } from './dopesheet-types'
import type { PropertyExpressionDraft } from './expression-reference-utils'
import { resolvePropertyRowPreExpressionValue } from './property-row-view-model'

export interface ExpressionDockContext {
  property: DirectLinkableProperty
  propertyLabel: string
  preExpressionValue: ExpressionValue
  postExpressionValue: ExpressionValue
  error?: string
  hasStoredExpression: boolean
}

export function formatExpressionValue(value: ExpressionValue | undefined): string {
  if (value === undefined) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '—'
  return `[${value.x.toFixed(2)}, ${value.y.toFixed(2)}]`
}

function findExpressionTargetRow(
  rows: readonly DopesheetPropertyRow[],
  compoundRows: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>,
  property: DirectLinkableProperty,
): DopesheetPropertyRow | undefined {
  return rows.find((candidate) => {
    const compoundProperty = compoundRows[candidate.property]?.linkProperty
    const scalarProperty = isLinkableAnimatableProperty(candidate.property)
      ? candidate.property
      : null
    return (compoundProperty ?? scalarProperty) === property
  })
}

function getExpressionPreviewError(
  property: DirectLinkableProperty,
  preview: PropertyExpressionResult,
): string | undefined {
  if (preview.error) return preview.error
  return isExpressionValueCompatible(property, preview.value)
    ? undefined
    : 'Expression result has the wrong value type'
}

export function buildExpressionDockContext(params: {
  editor: PropertyExpressionDraft
  rows: readonly DopesheetPropertyRow[]
  compoundRows: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>
  preExpressionValues: Partial<Record<AnimatableProperty, number>>
  propertyValues: Partial<Record<AnimatableProperty, number>>
  expressions: readonly PropertyExpression[]
  currentGlobalFrame: number
  fps: number
  resolveExpressionReference?: (
    itemId: string,
    property: DirectLinkableProperty,
  ) => ExpressionValue | null
  getPropertyLabel: (property: AnimatableProperty) => string
}): ExpressionDockContext | null {
  const row = findExpressionTargetRow(params.rows, params.compoundRows, params.editor.property)
  if (!row) return null

  const preExpressionValue = resolvePropertyRowPreExpressionValue(
    row.property,
    params.compoundRows[row.property],
    params.preExpressionValues,
    params.propertyValues,
  )
  if (preExpressionValue === undefined) return null

  const preview = evaluatePropertyExpression(params.editor.source, {
    preValue: preExpressionValue,
    globalFrame: params.currentGlobalFrame,
    fps: params.fps,
    resolveProperty: (sourceItemId, sourceProperty) =>
      params.resolveExpressionReference?.(sourceItemId, sourceProperty) ?? null,
  })
  const compoundRow = params.compoundRows[row.property]
  return {
    property: params.editor.property,
    propertyLabel: compoundRow?.label ?? params.getPropertyLabel(row.property),
    preExpressionValue,
    postExpressionValue: params.editor.enabled ? preview.value : preExpressionValue,
    error: getExpressionPreviewError(params.editor.property, preview),
    hasStoredExpression: params.expressions.some(
      (expression) => expression.targetProperty === params.editor.property,
    ),
  }
}
