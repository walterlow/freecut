/**
 * Quick presets for the export dialog: one-click container/codec/quality/
 * resolution targets, with the active one marked and "Custom" shown otherwise.
 */

import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import type { ExportPreset } from '../utils/export-options'

export interface ExportPresetGridProps {
  presets: readonly ExportPreset[]
  /** The preset the current settings exactly match, or null for "Custom". */
  activePresetId: ExportPreset['id'] | null
  onApplyPreset: (preset: ExportPreset) => void
}

export function ExportPresetGrid({
  presets,
  activePresetId,
  onApplyPreset,
}: ExportPresetGridProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('export.settings.presetLabel')}</Label>
        {activePresetId === null && (
          <span className="text-xs text-muted-foreground">{t('export.settings.presetCustom')}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((preset) => {
          const isActive = activePresetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              aria-pressed={isActive}
              className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {t(preset.labelKey)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
