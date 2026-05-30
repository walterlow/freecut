import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Download, FileVideo, FolderOpen, Loader2, Music, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createLogger } from '@/shared/logging/logger'
import {
  deleteExportFile,
  listExportFiles,
  readExportFile,
  workspaceFolderName,
  type ExportFileEntry,
} from '@/infrastructure/storage'
import { formatBytes } from '../utils/client-renderer'
import { useRenderQueueStore } from '../stores/render-queue-store'
import { RenderQueueList } from './render-queue-panel'

const log = createLogger('Export')

export interface ExportsDialogProps {
  open: boolean
  onClose: () => void
  /** Active project — new renders save to `projects/<id>/exports/`. */
  projectId: string
}

const AUDIO_EXTENSIONS = ['.mp3', '.aac', '.wav', '.m4a', '.opus']

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase()
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function ExportFileRow({ entry, onChanged }: { entry: ExportFileEntry; onChanged: () => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const handleDownload = async () => {
    setBusy(true)
    try {
      const blob = await readExportFile(entry.path)
      if (!blob) {
        toast.error(t('export.renderQueue.missingFile'))
        onChanged()
        return
      }
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      requestIdleCallback(() => URL.revokeObjectURL(url))
    } catch (err) {
      log.error('Failed to download export', err)
      toast.error(t('export.renderQueue.downloadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteExportFile(entry.path)
      toast.success(t('export.renderQueue.deleted', { name: entry.name }))
      onChanged()
    } catch (err) {
      log.error('Failed to delete export', err)
      toast.error(t('export.renderQueue.deleteFailed'))
      setBusy(false)
    }
  }

  const FileIcon = isAudioFile(entry.name) ? Music : FileVideo

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
      <FileIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {formatBytes(entry.size)}
          {entry.lastModified > 0 ? ` · ${new Date(entry.lastModified).toLocaleString()}` : ''}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={busy}
          onClick={handleDownload}
          aria-label={t('export.renderQueue.download')}
          data-tooltip={t('export.renderQueue.download')}
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={busy}
          onClick={handleDelete}
          aria-label={t('export.renderQueue.delete')}
          data-tooltip={t('export.renderQueue.delete')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ExportsList({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<ExportFileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Re-list whenever a job finishes saving a new file.
  const completedCount = useRenderQueueStore(
    (s) => s.jobs.filter((j) => j.status === 'completed').length,
  )
  const folder = workspaceFolderName()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await listExportFiles(projectId))
    } catch (err) {
      log.error('Failed to list exports', err)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load, completedCount])

  return (
    <div className="space-y-3">
      {/* Tell users where the files actually live (browsers can't open the OS folder). */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <FolderOpen className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          {folder
            ? t('export.renderQueue.exportsLocation', { folder })
            : t('export.renderQueue.exportsLocationGeneric')}
        </span>
      </div>

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('export.renderQueue.refresh')}
        </Button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto pr-1">
        {entries === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <FolderOpen className="h-6 w-6" />
            {t('export.renderQueue.exportsEmpty')}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <ExportFileRow
                key={entry.path.join('/')}
                entry={entry}
                onChanged={() => void load()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Dedicated dialog for the render queue and the saved export files. The Queue
 * tab shows this session's jobs; the Exports tab browses the project's
 * `projects/<id>/exports/` folder and lets you download / delete them.
 */
export function ExportsDialog({ open, onClose, projectId }: ExportsDialogProps) {
  const { t } = useTranslation()
  const activeCount = useRenderQueueStore(
    (s) => s.jobs.filter((j) => j.status === 'queued' || j.status === 'rendering').length,
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('export.renderQueue.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('export.renderQueue.description')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={activeCount > 0 ? 'queue' : 'exports'}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="queue" className="gap-1.5">
              {t('export.renderQueue.tabQueue')}
              {activeCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium leading-tight text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="exports">{t('export.renderQueue.tabExports')}</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <RenderQueueList />
          </TabsContent>
          <TabsContent value="exports" className="mt-4">
            <ExportsList projectId={projectId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
