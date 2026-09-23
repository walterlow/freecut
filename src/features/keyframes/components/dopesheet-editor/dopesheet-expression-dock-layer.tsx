/**
 * Expression dock layer for the dopesheet.
 * Owns the dock's wiring: the guarded draft edits, the pick-whip arming, and the
 * apply/remove/cancel lifecycle. The editor only decides whether the dock is up
 * and hands over its own state handles.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { DirectLinkableProperty } from '@/types/keyframe'
import { DopesheetExpressionDock } from './dopesheet-expression-dock'
import { formatExpressionValue, type ExpressionDockContext } from './expression-dock-context'
import type {
  ExpressionReferenceDragOrigin,
  PropertyExpressionDraft,
} from './expression-reference-utils'
import type { PropertyExpressionEditorApi } from './use-property-expression-editor'

export interface DopesheetExpressionDockLayerProps {
  /** Preview data for the property being edited. */
  context: ExpressionDockContext
  /** Draft source/enabled/selection state for that property. */
  editor: PropertyExpressionDraft
  /** Whether this property's reference pick-whip is armed. */
  pickingReference: boolean
  itemId: string
  rootRef: RefObject<HTMLElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setEditor: Dispatch<SetStateAction<PropertyExpressionDraft | null>>
  setReferencePick: Dispatch<SetStateAction<ExpressionReferenceDragOrigin | null>>
  beginReferenceDrag: PropertyExpressionEditorApi['beginExpressionReferenceDrag']
  applyPreset: PropertyExpressionEditorApi['applyExpressionPreset']
  /** Create or update the sandboxed expression for the edited property. */
  onSetPropertyExpression?: (
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  /** Remove the sandboxed expression for the edited property. */
  onRemovePropertyExpression?: (property: DirectLinkableProperty) => void
}

/** Renders the expression dock for the draft it is given. */
export function DopesheetExpressionDockLayer({
  context,
  editor,
  pickingReference,
  itemId,
  rootRef,
  textareaRef,
  setEditor,
  setReferencePick,
  beginReferenceDrag,
  applyPreset,
  onSetPropertyExpression,
  onRemovePropertyExpression,
}: DopesheetExpressionDockLayerProps) {
  const { property } = context
  return (
    <DopesheetExpressionDock
      property={property}
      propertyLabel={context.propertyLabel}
      source={editor.source}
      enabled={editor.enabled}
      preExpressionDisplay={formatExpressionValue(context.preExpressionValue)}
      postExpressionDisplay={formatExpressionValue(context.postExpressionValue)}
      error={context.error}
      hasStoredExpression={context.hasStoredExpression}
      pickingReference={pickingReference}
      rootRef={rootRef}
      textareaRef={textareaRef}
      onSourceChange={(source, selectionStart, selectionEnd) =>
        setEditor((current) =>
          current?.property === property
            ? { ...current, source, selectionStart, selectionEnd }
            : current,
        )
      }
      onSelectionChange={(selectionStart, selectionEnd) =>
        setEditor((current) =>
          current?.property === property ? { ...current, selectionStart, selectionEnd } : current,
        )
      }
      onToggleEnabled={() =>
        setEditor((current) =>
          current?.property === property ? { ...current, enabled: !current.enabled } : current,
        )
      }
      onApplyPreset={(source) => applyPreset(property, source)}
      onReferencePointerDown={(event, selectionStart, selectionEnd) => {
        setReferencePick(null)
        beginReferenceDrag(event, { itemId, property, selectionStart, selectionEnd })
      }}
      onToggleReferencePicking={(selectionStart, selectionEnd) =>
        setReferencePick((current) =>
          current?.property === property
            ? null
            : { itemId, property, selectionStart, selectionEnd },
        )
      }
      onRemove={() => {
        onRemovePropertyExpression?.(property)
        setReferencePick(null)
        setEditor(null)
      }}
      onCancel={() => {
        setReferencePick(null)
        setEditor(null)
      }}
      onApply={() => {
        if (context.error) return
        onSetPropertyExpression?.(property, editor.source, editor.enabled)
        setReferencePick(null)
        setEditor(null)
      }}
    />
  )
}
