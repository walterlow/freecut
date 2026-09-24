/**
 * Export range readout for the export dialog: the in/out frame window the
 * render covers, plus the whole-project switch when a range is set.
 */

import { useTranslation } from 'react-i18next'
import { Scissors } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatTimecode, framesToSeconds } from '@/shared/utils/time-utils'
import type { ExportRange } from '../utils/export-range'
import { formatTime } from '../utils/export-format'

export interface ExportRangeSummaryProps {
  /** Frame window the export covers. */
  range: ExportRange
  fps: number
  hasInOutPoints: boolean
  renderWholeProject: boolean
  onRenderWholeProjectChange: (renderWholeProject: boolean) => void
}

export function ExportRangeSummary({
  range,
  fps,
  hasInOutPoints,
  renderWholeProject,
  onRenderWholeProjectChange,
}: ExportRangeSummaryProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('export.settings.exportRange')}</span>
        </div>
        {hasInOutPoints && (
          <div className="flex items-center gap-2">
            <Label htmlFor="render-whole" className="text-xs text-muted-foreground">
              {t('export.settings.renderWholeProject')}
            </Label>
            <Switch
              id="render-whole"
              checked={renderWholeProject}
              onCheckedChange={onRenderWholeProjectChange}
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">{t('export.settings.in')}</div>
          <div className="font-mono text-foreground">{formatTimecode(range.start, fps)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">{t('export.settings.out')}</div>
          <div className="font-mono text-foreground">{formatTimecode(range.end, fps)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">
            {t('export.settings.duration')}
          </div>
          <div className="font-mono text-foreground">
            {formatTime(framesToSeconds(range.duration, fps))}
          </div>
        </div>
      </div>
      {hasInOutPoints && !renderWholeProject && (
        <p className="text-xs text-muted-foreground">{t('export.settings.inOutRangeHint')}</p>
      )}
    </div>
  )
}
