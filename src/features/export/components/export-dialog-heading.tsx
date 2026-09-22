/**
 * Dialog header for the export dialog: the title and description of the step
 * currently showing.
 */

import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DialogView } from '../hooks/use-export-dialog-view'

export function ExportDialogHeading({ view }: { view: DialogView }) {
  const { t } = useTranslation()

  // Dynamic title and description
  const getTitle = () => {
    switch (view) {
      case 'settings':
        return t('export.dialog.titleSettings')
      case 'progress':
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {t('export.dialog.titleProgress')}
          </span>
        )
      case 'complete':
        return (
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            {t('export.dialog.titleComplete')}
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t('export.dialog.titleError')}
          </span>
        )
      case 'cancelled':
        return (
          <span className="flex items-center gap-2">
            <X className="h-5 w-5 text-muted-foreground" />
            {t('export.dialog.titleCancelled')}
          </span>
        )
    }
  }

  const getDescription = () => {
    switch (view) {
      case 'settings':
        return t('export.dialog.descSettings')
      case 'progress':
        return t('export.dialog.descProgress')
      case 'complete':
        return t('export.dialog.descComplete')
      case 'error':
        return t('export.dialog.descError')
      case 'cancelled':
        return t('export.dialog.descCancelled')
    }
  }

  return (
    <DialogHeader>
      <DialogTitle>{getTitle()}</DialogTitle>
      <DialogDescription>{getDescription()}</DialogDescription>
    </DialogHeader>
  )
}
