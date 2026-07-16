import { AlertTriangle, Copy, Download, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ProjectSyncConflictDialogProps {
  open: boolean
  revision: string | null
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onKeepBoth: () => void
  onUseExternal: () => void
  onUseEditor: () => void
  onLater: () => void
}

export function ProjectSyncConflictDialog({
  open,
  revision,
  busy,
  error,
  onOpenChange,
  onKeepBoth,
  onUseExternal,
  onUseEditor,
  onLater,
}: ProjectSyncConflictDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            {t('editor.editor.syncConflict.title')}
          </DialogTitle>
          <DialogDescription>
            {t('editor.editor.syncConflict.description')}
            {revision ? (
              <span className="mt-2 block font-mono text-xs">
                {t('editor.editor.syncConflict.revision', {
                  revision: revision.slice(0, 12),
                })}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-20 flex-col items-start gap-1 whitespace-normal text-left"
            disabled={busy}
            onClick={onKeepBoth}
          >
            <span className="flex items-center gap-2 font-medium">
              <Copy className="size-4" />
              {t('editor.editor.syncConflict.keepBoth')}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('editor.editor.syncConflict.keepBothHint')}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-20 flex-col items-start gap-1 whitespace-normal text-left"
            disabled={busy}
            onClick={onUseExternal}
          >
            <span className="flex items-center gap-2 font-medium">
              <Download className="size-4" />
              {t('editor.editor.syncConflict.useExternal')}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('editor.editor.syncConflict.useExternalHint')}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-20 flex-col items-start gap-1 whitespace-normal text-left"
            disabled={busy}
            onClick={onUseEditor}
          >
            <span className="flex items-center gap-2 font-medium">
              <Upload className="size-4" />
              {t('editor.editor.syncConflict.useEditor')}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('editor.editor.syncConflict.useEditorHint')}
            </span>
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onLater}>
            {t('editor.editor.syncConflict.later')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
