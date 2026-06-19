import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Eye, EyeOff, Palette, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PropertyRow } from '@/shared/ui/property-controls'
import { EffectMoveButtons, type EffectMoveProps } from './effect-move-buttons'

interface EffectPanelHeaderActionsProps extends EffectMoveProps {
  effectId: string
  enabled: boolean
  isDefault: boolean
  onReset: (effectId: string) => void
  onToggle: (effectId: string) => void
  onRemove: (effectId: string) => void
  /** When set, render a button that jumps to the Color workspace. */
  onEditInColor?: () => void
}

export function EffectPanelHeaderActions({
  effectId,
  enabled,
  isDefault,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  onEditInColor,
}: EffectPanelHeaderActionsProps) {
  const { t } = useTranslation()
  const resetLabel = t('effects.panel.resetToDefaults')
  const toggleLabel = enabled ? t('effects.panel.disableEffect') : t('effects.panel.enableEffect')
  const removeLabel = t('effects.panel.removeEffect')
  const editInColorLabel = t('effects.panel.editInColor')

  return (
    <>
      {onEditInColor ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={onEditInColor}
          title={editInColorLabel}
          aria-label={editInColorLabel}
        >
          <Palette className="w-3 h-3" />
        </Button>
      ) : null}
      <EffectMoveButtons
        effectId={effectId}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
        onClick={() => onReset(effectId)}
        title={resetLabel}
        aria-label={resetLabel}
        disabled={isDefault}
      >
        <RotateCcw className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onToggle(effectId)}
        title={toggleLabel}
        aria-label={toggleLabel}
      >
        {enabled ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onRemove(effectId)}
        title={removeLabel}
        aria-label={removeLabel}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </>
  )
}

interface EffectPanelHeaderRowProps extends EffectPanelHeaderActionsProps {
  label: string
  /**
   * When provided, the row becomes a collapsible disclosure: a chevron + label
   * on the left toggle the panel body. `collapsed` reflects the current state.
   */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function EffectPanelHeaderRow({
  label,
  collapsed,
  onToggleCollapsed,
  ...actions
}: EffectPanelHeaderRowProps) {
  if (onToggleCollapsed) {
    // Surface a "modified" dot while collapsed so a graded clip reads as graded
    // without expanding the panel.
    const showModifiedDot = collapsed === true && !actions.isDefault
    return (
      <div className="flex items-center justify-between gap-2 min-w-0 py-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={collapsed !== true}
          className="flex flex-1 items-center gap-1 min-w-0 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed === true ? (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <span className="truncate">{label}</span>
          {showModifiedDot ? (
            <span
              className="ml-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
        </button>
        <div className="flex items-center gap-1 min-w-0 justify-end">
          <EffectPanelHeaderActions {...actions} />
        </div>
      </div>
    )
  }

  return (
    <PropertyRow label={label}>
      <div className="flex items-center gap-1 min-w-0 w-full justify-end">
        <EffectPanelHeaderActions {...actions} />
      </div>
    </PropertyRow>
  )
}
