/**
 * Export type switch for the export dialog: whether the render carries video
 * (with its container/codec settings) or audio only.
 */

import { useTranslation } from 'react-i18next'
import { Music, Video } from 'lucide-react'
import { Label } from '@/components/ui/label'
import type { ExportMode } from '@/types/export'

export interface ExportModeToggleProps {
  mode: ExportMode
  onChange: (mode: ExportMode) => void
}

const TOGGLE_CLASS =
  'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors'

export function ExportModeToggle({ mode, onChange }: ExportModeToggleProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm font-medium">{t('export.settings.exportType')}</Label>
      <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
        <button
          type="button"
          onClick={() => onChange('video')}
          className={`${TOGGLE_CLASS} ${
            mode === 'video'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Video className="h-3.5 w-3.5" />
          {t('export.settings.video')}
        </button>
        <button
          type="button"
          onClick={() => onChange('audio')}
          className={`${TOGGLE_CLASS} ${
            mode === 'audio'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Music className="h-3.5 w-3.5" />
          {t('export.settings.audio')}
        </button>
      </div>
    </div>
  )
}
