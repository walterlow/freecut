import { CheckCircle2, Loader2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

import { useSubtitleScanProgressStore } from '../stores/subtitle-scan-progress-store'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function SubtitleScanProgressDialog() {
  const open = useSubtitleScanProgressStore((s) => s.open)
  const entries = useSubtitleScanProgressStore((s) => s.entries)
  const currentIndex = useSubtitleScanProgressStore((s) => s.currentIndex)
  const summary = useSubtitleScanProgressStore((s) => s.summary)
  const close = useSubtitleScanProgressStore((s) => s.close)

  const isMulti = entries.length > 1
  const isFinished = summary !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isFinished ? 'Subtitle scan complete' : 'Scanning embedded subtitles'}
          </DialogTitle>
          <DialogDescription>
            {isFinished
              ? 'Subtitle tracks are cached. Insert them onto the timeline from the clip context menu.'
              : 'Reading the source file to discover and cache its subtitle tracks. No timeline changes will be made.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {entries.map((entry, index) => {
            const fraction =
              entry.totalBytes > 0 ? Math.min(1, entry.bytesRead / entry.totalBytes) : 0
            const percent = Math.round(fraction * 100)
            const isCurrent = index === currentIndex && !isFinished
            return (
              <div key={`${entry.fileName}-${index}`} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm">
                  {entry.status === 'scanning' && (
                    <Loader2 className="w-3 h-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  {entry.status === 'done' && (
                    <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />
                  )}
                  {entry.status === 'error' && (
                    <XCircle className="w-3 h-3 shrink-0 text-destructive" />
                  )}
                  <span className="truncate flex-1">{entry.fileName}</span>
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {entry.status === 'done'
                      ? 'Cached'
                      : entry.status === 'error'
                        ? 'Failed'
                        : `${percent}%`}
                  </span>
                </div>
                <Progress value={percent} className="h-2" />
                {isCurrent && entry.totalBytes > 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(entry.bytesRead)} / {formatBytes(entry.totalBytes)}
                  </p>
                )}
              </div>
            )
          })}
          {isFinished && summary && <p className="pt-1 text-sm text-muted-foreground">{summary}</p>}
        </div>

        <DialogFooter>
          <Button variant={isFinished ? 'default' : 'ghost'} onClick={close}>
            {isFinished ? 'Close' : isMulti ? 'Cancel batch' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
