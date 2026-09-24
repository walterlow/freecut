/**
 * Progress step of the export dialog: the bar, the phase (or the renderer's own
 * message), the frame/time counters and the cancel action.
 */

import { useTranslation } from 'react-i18next'
import { Clock, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { ClientRenderStatus } from '../hooks/use-client-render'
import { formatTime } from '../utils/export-format'

export interface ExportProgressViewProps {
  progress: number
  progressMessage: string | undefined
  renderedFrames: number | undefined
  totalFrames: number | undefined
  status: ClientRenderStatus
  elapsedSeconds: number
  onCancel: () => void
}

/** Translate lookup, narrowed to the key shape this file uses. */
type Translate = (key: string) => string

/** Line under the bar: the phase, or the renderer's own message while preparing. */
function progressLabel(
  status: ClientRenderStatus,
  progressMessage: string | undefined,
  t: Translate,
): string {
  switch (status) {
    case 'preparing':
      return progressMessage ?? t('export.progress.preparing')
    case 'rendering':
      return t('export.progress.rendering')
    case 'encoding':
      return t('export.progress.encoding')
    case 'finalizing':
      return t('export.progress.finalizing')
    default:
      return ''
  }
}

export function ExportProgressView({
  progress,
  progressMessage,
  renderedFrames,
  totalFrames,
  status,
  elapsedSeconds,
  onCancel,
}: ExportProgressViewProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4 py-4 overflow-hidden">
      <div className="space-y-4 min-w-0">
        <div className="space-y-2 min-w-0">
          <div className="w-full overflow-hidden">
            <Progress value={progress} className="h-2 w-full" />
          </div>
          <div className="flex items-center justify-between text-sm gap-2">
            <span className="text-muted-foreground truncate">
              {progressLabel(status, progressMessage, t)}
            </span>
            <span className="font-medium tabular-nums flex-shrink-0">{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {renderedFrames !== undefined && totalFrames !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t('export.progress.framesLabel')}</span>
              <span className="font-medium tabular-nums">
                {renderedFrames}/{totalFrames}
              </span>
            </div>
          )}
          {elapsedSeconds > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t('export.progress.elapsedLabel')}</span>
              <span className="font-medium tabular-nums">{formatTime(elapsedSeconds)}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t('export.progress.keepTabOpen')}</p>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onCancel}>
          {t('export.progress.cancelExport')}
        </Button>
      </div>
    </div>
  )
}
