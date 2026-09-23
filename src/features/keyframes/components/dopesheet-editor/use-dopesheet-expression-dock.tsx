/**
 * Dopesheet expression dock wiring.
 * Builds the dock's context from the open draft, the sheet rows and the
 * property values, closes a dock whose context can no longer be built, and
 * renders the dock layer. The dock component itself stays presentational; this
 * hook owns the plumbing between the editor's expression state and it.
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { buildExpressionDockContext } from './expression-dock-context'
import { DopesheetExpressionDockLayer } from './dopesheet-expression-dock-layer'
import { getKeyframePropertyLabel } from '@/features/keyframes/utils/property-i18n'
import type { PropertyExpressionEditorApi } from './use-property-expression-editor'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import type { DopesheetPropertyRow } from './dopesheet-types'

export interface UseDopesheetExpressionDockOptions {
  editor: PropertyExpressionEditorApi['expressionEditor']
  referencePick: PropertyExpressionEditorApi['expressionReferencePick']
  dockRef: PropertyExpressionEditorApi['expressionDockRef']
  textareaRef: PropertyExpressionEditorApi['expressionTextareaRef']
  setEditor: PropertyExpressionEditorApi['setExpressionEditor']
  setReferencePick: PropertyExpressionEditorApi['setExpressionReferencePick']
  beginReferenceDrag: PropertyExpressionEditorApi['beginExpressionReferenceDrag']
  applyPreset: PropertyExpressionEditorApi['applyExpressionPreset']
  itemId: string
  rows: DopesheetPropertyRow[]
  compoundRows: NonNullable<DopesheetEditorProps['compoundPropertyRows']>
  preExpressionValues: NonNullable<DopesheetEditorProps['preExpressionPropertyValues']>
  propertyValues: NonNullable<DopesheetEditorProps['propertyValues']>
  expressions: NonNullable<DopesheetEditorProps['propertyExpressions']>
  currentFrame: number
  globalFrame: DopesheetEditorProps['globalFrame']
  itemFrom: number
  fps: number
  resolveExpressionReference: DopesheetEditorProps['resolveExpressionReference']
  onSetPropertyExpression: DopesheetEditorProps['onSetPropertyExpression']
  onRemovePropertyExpression: DopesheetEditorProps['onRemovePropertyExpression']
}

/**
 * Renders the expression dock layer for the open draft, or nothing when no
 * draft is open. The returned element is placed by the presentation shell.
 */
export function useDopesheetExpressionDock({
  editor,
  referencePick,
  dockRef,
  textareaRef,
  setEditor,
  setReferencePick,
  beginReferenceDrag,
  applyPreset,
  itemId,
  rows,
  compoundRows,
  preExpressionValues,
  propertyValues,
  expressions,
  currentFrame,
  globalFrame,
  itemFrom,
  fps,
  resolveExpressionReference,
  onSetPropertyExpression,
  onRemovePropertyExpression,
}: UseDopesheetExpressionDockOptions): ReactNode {
  const { t } = useTranslation()
  const expressionDockContext = useMemo(() => {
    if (!editor) return null
    return buildExpressionDockContext({
      editor,
      rows,
      compoundRows,
      preExpressionValues,
      propertyValues,
      expressions,
      currentGlobalFrame: globalFrame ?? itemFrom + currentFrame,
      fps,
      resolveExpressionReference,
      getPropertyLabel: (property) => getKeyframePropertyLabel(t, property),
    })
  }, [
    compoundRows,
    currentFrame,
    editor,
    fps,
    globalFrame,
    itemFrom,
    preExpressionValues,
    expressions,
    propertyValues,
    resolveExpressionReference,
    rows,
    t,
  ])
  useEffect(() => {
    if (editor && !expressionDockContext) {
      setReferencePick(null)
      setEditor(null)
    }
  }, [expressionDockContext, editor, setEditor, setReferencePick])

  return editor && expressionDockContext ? (
    <DopesheetExpressionDockLayer
      context={expressionDockContext}
      editor={editor}
      pickingReference={referencePick?.property === expressionDockContext.property}
      itemId={itemId}
      rootRef={dockRef}
      textareaRef={textareaRef}
      setEditor={setEditor}
      setReferencePick={setReferencePick}
      beginReferenceDrag={beginReferenceDrag}
      applyPreset={applyPreset}
      onSetPropertyExpression={onSetPropertyExpression}
      onRemovePropertyExpression={onRemovePropertyExpression}
    />
  ) : null
}
