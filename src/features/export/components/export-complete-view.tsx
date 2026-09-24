/**
 * Complete step of the export dialog: the preview player, the success note, the
 * output size and time, and the download/close actions.
 */

import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, Download, HardDrive } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ExportMode } from '@/types/export'
import { ExportPreviewPlayer } from './export-preview-player'
import { formatFileSize, formatTime } from '../utils/export-format'

export interface ExportCompleteViewProps {
  mode: ExportMode
  /** Blob URL of the finished render, when it produced one. */
  previewUrl: string | null
  isVideoResult: boolean
  fileSize: number | undefined
  elapsedSeconds: number
  onClose: () => void
  onDownload: () => void
}

export function ExportCompleteView({
  mode,
  previewUrl,
  isVideoResult,
  fileSize,
  elapsedSeconds,
  onClose,
  onDownload,
}: ExportCompleteViewProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4 py-4">
      {previewUrl && <ExportPreviewPlayer src={previewUrl} isVideo={isVideoResult} />}

      <Alert className="border-green-900 bg-green-950">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <AlertDescription className="text-green-400">
          {mode === 'audio' ? t('export.complete.audioSuccess') : t('export.complete.videoSuccess')}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {fileSize && (
          <div className="flex items-center gap-2 text-sm">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('export.complete.fileSizeLabel')}</span>
            <span className="font-medium">{formatFileSize(fileSize)}</span>
          </div>
        )}
        {elapsedSeconds > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('export.complete.timeTakenLabel')}</span>
            <span className="font-medium">{formatTime(elapsedSeconds)}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          {t('export.complete.download')}
        </Button>
      </div>
    </div>
  )
}
