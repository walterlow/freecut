import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FolderCheck,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { framesToSeconds } from '@/shared/utils/time-utils'
import { formatBytes } from '../utils/client-renderer'
import {
  useRenderQueueStore,
  type RenderJob,
  type RenderJobStatus,
} from '../stores/render-queue-store'

function formatDuration(frames: number, fps: number): string {
  const seconds = framesToSeconds(frames, fps)
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return `${minutes}m ${remaining}s`
}

function StatusIcon({ status }: { status: RenderJobStatus }) {
  switch (status) {
    case 'queued':
      return <Clock className="h-4 w-4 text-muted-foreground" />
    case 'rendering':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-destructive" />
    case 'cancelled':
      return <X className="h-4 w-4 text-muted-foreground" />
  }
}

function JobRow({ job }: { job: RenderJob }) {
  const { t } = useTranslation()
  const cancelJob = useRenderQueueStore((s) => s.cancelJob)
  const removeJob = useRenderQueueStore((s) => s.removeJob)
  const retryJob = useRenderQueueStore((s) => s.retryJob)
  const moveJob = useRenderQueueStore((s) => s.moveJob)

  const fps = job.snapshot.fps
  const formatBits =
    job.exportMode === 'audio'
      ? job.clientSettings.container.toUpperCase()
      : `${job.clientSettings.container.toUpperCase()} · ${job.clientSettings.resolution.width}×${job.clientSettings.resolution.height}`
  const rangeText =
    job.inPoint == null || job.outPoint == null
      ? t('export.renderQueue.wholeProject')
      : `${Math.round(framesToSeconds(job.inPoint, fps))}s–${Math.round(framesToSeconds(job.outPoint, fps))}s`

  const isQueued = job.status === 'queued'
  const isRendering = job.status === 'rendering'
  const isFinished =
    job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">
          <StatusIcon status={job.status} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{job.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatBits} · {rangeText} · {formatDuration(job.durationFrames, fps)}
          </div>

          {isRendering && (
            <div className="mt-2 space-y-1">
              <Progress value={job.progress} className="h-1.5 w-full" />
              <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {job.renderedFrames !== undefined && job.totalFrames !== undefined
                    ? `${job.renderedFrames}/${job.totalFrames}`
                    : t(`export.renderQueue.status.${job.status}`)}
                </span>
                <span>{Math.round(job.progress)}%</span>
              </div>
            </div>
          )}

          {job.status === 'completed' && job.savedPath && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-green-500">
              <FolderCheck className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {t('export.renderQueue.savedTo', { path: job.savedPath })}
                {job.fileSize ? ` (${formatBytes(job.fileSize)})` : ''}
              </span>
            </div>
          )}

          {job.status === 'failed' && job.error && (
            <div className="mt-1 truncate text-xs text-destructive" title={job.error}>
              {job.error}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-0.5">
          {isQueued && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => moveJob(job.id, -1)}
                aria-label={t('export.renderQueue.moveUp')}
                data-tooltip={t('export.renderQueue.moveUp')}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => moveJob(job.id, 1)}
                aria-label={t('export.renderQueue.moveDown')}
                data-tooltip={t('export.renderQueue.moveDown')}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </>
          )}

          {isFinished && job.status !== 'completed' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => retryJob(job.id)}
              aria-label={t('export.renderQueue.retry')}
              data-tooltip={t('export.renderQueue.retry')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}

          {(isQueued || isRendering) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => cancelJob(job.id)}
              aria-label={t('export.renderQueue.cancel')}
              data-tooltip={t('export.renderQueue.cancel')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {isFinished && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => removeJob(job.id)}
              aria-label={t('export.renderQueue.remove')}
              data-tooltip={t('export.renderQueue.remove')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The render queue: pause/clear controls plus the job list. Presentational —
 * no dialog chrome — so it can be embedded in the Exports dialog's Queue tab.
 */
export function RenderQueueList() {
  const { t } = useTranslation()
  const jobs = useRenderQueueStore((s) => s.jobs)
  const isPaused = useRenderQueueStore((s) => s.isPaused)
  const setPaused = useRenderQueueStore((s) => s.setPaused)
  const clearFinished = useRenderQueueStore((s) => s.clearFinished)
  const clearAll = useRenderQueueStore((s) => s.clearAll)

  const hasFinished = jobs.some(
    (j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled',
  )
  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'rendering')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setPaused(!isPaused)}
          disabled={!hasActive}
        >
          {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {isPaused ? t('export.renderQueue.resume') : t('export.renderQueue.pause')}
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={clearFinished} disabled={!hasFinished}>
            {t('export.renderQueue.clearFinished')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={clearAll}
            disabled={jobs.length === 0}
          >
            {t('export.renderQueue.clearAll')}
          </Button>
        </div>
      </div>

      {isPaused && jobs.some((j) => j.status === 'queued') && (
        <p className="text-xs text-amber-500">{t('export.renderQueue.paused')}</p>
      )}

      <div className="max-h-[55vh] overflow-y-auto pr-1">
        {jobs.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('export.renderQueue.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
