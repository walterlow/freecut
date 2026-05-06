import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/shared/logging/logger'
import {
  clearLocalModelCache,
  inspectAllLocalModelCaches,
  supportsLocalModelCacheInspection,
  type LocalModelCacheSummary,
} from '@/shared/utils/local-model-cache'
import { cn } from '@/shared/ui/cn'
import { formatBytes } from '@/shared/utils/format-utils'

const log = createLogger('LocalModelCacheControl')

interface LocalModelCacheControlProps {
  className?: string
}

export function LocalModelCacheControl({ className }: LocalModelCacheControlProps) {
  const [cacheSummaries, setCacheSummaries] = useState<LocalModelCacheSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [clearingCacheId, setClearingCacheId] = useState<LocalModelCacheSummary['id'] | null>(null)
  const [clearedCacheId, setClearedCacheId] = useState<LocalModelCacheSummary['id'] | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const inspectionSupported = supportsLocalModelCacheInspection()

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const refreshCacheSummaries = useCallback(async () => {
    if (!inspectionSupported) {
      if (mountedRef.current) {
        setCacheSummaries([])
        setIsLoading(false)
      }
      return
    }

    if (mountedRef.current) {
      setIsLoading(true)
    }

    try {
      const nextSummaries = await inspectAllLocalModelCaches()
      if (!mountedRef.current) return
      setCacheSummaries(nextSummaries)
    } catch (error) {
      log.error('Failed to inspect local model cache state', error)
      if (mountedRef.current) {
        toast.error('Failed to inspect local model cache')
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [inspectionSupported])

  useEffect(() => {
    void refreshCacheSummaries()
  }, [refreshCacheSummaries])

  const scheduleReset = useCallback((cacheId: LocalModelCacheSummary['id']) => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      setClearedCacheId(null)
    }

    setClearedCacheId(cacheId)
    resetTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setClearedCacheId(null)
      }
      resetTimerRef.current = null
    }, 2000)
  }, [])

  const handleClear = useCallback(
    async (summary: LocalModelCacheSummary) => {
      setClearingCacheId(summary.id)

      try {
        const deleted = await clearLocalModelCache(summary)
        await refreshCacheSummaries()
        scheduleReset(summary.id)
        toast.success(deleted ? `Cleared ${summary.label}` : `${summary.label} was already empty`)
      } catch (error) {
        log.error(`Failed to clear local model cache ${summary.id}`, error)
        toast.error(`Failed to clear ${summary.label}`)
      } finally {
        if (mountedRef.current) {
          setClearingCacheId(null)
        }
      }
    },
    [refreshCacheSummaries, scheduleReset],
  )

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Local AI Model Cache</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Shows cached model size. Clear a model to force a fresh download next time.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-28 shrink-0 gap-1.5"
          onClick={() => {
            void refreshCacheSummaries()
          }}
          disabled={!inspectionSupported || isLoading}
        >
          <RotateCcw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          {isLoading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {!inspectionSupported && (
        <p className="text-xs text-muted-foreground">
          Cache inspection is unavailable in this environment.
        </p>
      )}

      {inspectionSupported &&
        cacheSummaries.map((summary) => {
          const isClearing = clearingCacheId === summary.id
          const isCleared = clearedCacheId === summary.id
          const sizeLabel =
            summary.inspectionState === 'timed-out'
              ? 'Unavailable'
              : summary.inspectionState === 'error'
                ? 'Unavailable'
                : !summary.downloaded
                  ? '0 B'
                  : summary.sizeStatus === 'exact' || summary.sizeStatus === 'partial'
                    ? `Approx. ${formatBytes(summary.totalBytes)}`
                    : 'Unavailable'

          return (
            <div
              key={summary.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate font-medium">{summary.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-28 shrink-0 gap-1.5"
                onClick={() => {
                  void handleClear(summary)
                }}
                disabled={isClearing}
              >
                {isClearing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isCleared && !isClearing && <Check className="h-3.5 w-3.5" />}
                {!isClearing && !isCleared && <Trash2 className="h-3.5 w-3.5" />}
                {isClearing ? 'Clearing...' : isCleared ? 'Cleared' : 'Clear'}
              </Button>
            </div>
          )
        })}
    </div>
  )
}
