/**
 * Terminal step of the export dialog that only reports an outcome: the failure
 * message, or the note that the export was cancelled. Both offer just "Close".
 */

import { useTranslation } from 'react-i18next'
import { AlertCircle, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export interface ExportNoticeViewProps {
  variant: 'error' | 'cancelled'
  /** Failure text — only read for the error variant. */
  message: string | null
  onClose: () => void
}

export function ExportNoticeView({ variant, message, onClose }: ExportNoticeViewProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4 py-4">
      {variant === 'error' ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <X className="h-4 w-4" />
          <AlertDescription>{t('export.cancelled.message')}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  )
}
