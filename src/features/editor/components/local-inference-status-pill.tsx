import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/shared/hooks/use-prefers-reduced-motion'
import {
  formatEstimatedBytes,
  getLocalInferenceSummary,
  useLocalInferenceStore,
  type LocalInferenceSummary,
} from '@/shared/state/local-inference'
import { formatBytes } from '@/shared/utils/format-utils'

export function LocalInferenceStatusPill() {
  const { t } = useTranslation()
  const runtimesById = useLocalInferenceStore((state) => state.runtimesById)
  const summary = useMemo(() => getLocalInferenceSummary(runtimesById), [runtimesById])
  const prefersReducedMotion = usePrefersReducedMotion()
  const enterY = prefersReducedMotion ? 0 : -4

  function getStateLabel(summary: LocalInferenceSummary): string {
    switch (summary.state) {
      case 'loading':
        // "Loading" hides a multi-minute weight download behind the same word as a 20 s
        // graph compile. Name whichever one is actually happening — and never call a
        // seconds-long read from local cache a download.
        if (summary.loadingPhase === 'downloading') {
          return summary.loadingFromCache
            ? t('editor.localInferencePill.loadingCache')
            : t('editor.localInferencePill.downloading')
        }
        if (summary.loadingPhase === 'preparing') {
          return t('editor.localInferencePill.preparing')
        }
        return t('editor.localInferencePill.loading')
      case 'running':
        return t('editor.localInferencePill.active')
      case 'error':
        return t('editor.localInferencePill.error')
      case 'ready':
        return t('editor.localInferencePill.ready')
    }
  }

  // While weights stream in, the size slot shows how far along the transfer is rather than a
  // static "~1.2 GB est" that never changes.
  const sizeLabel =
    summary && summary.loadingPhase === 'downloading' && summary.totalEstimatedBytes > 0
      ? `${formatBytes(summary.loadedBytes)} of ${formatBytes(summary.totalEstimatedBytes)}`
      : summary
        ? formatEstimatedBytes(summary.totalEstimatedBytes)
        : null

  const detailParts = summary
    ? [
        summary.primaryLabel,
        summary.backendLabel,
        summary.activeJobs > 0
          ? t('editor.localInferencePill.jobs', { count: summary.activeJobs })
          : null,
        sizeLabel,
      ].filter(Boolean)
    : []

  // AnimatePresence keeps the pill mounted long enough to play the exit fade
  // when local inference finishes, so it eases out instead of popping away.
  return (
    <AnimatePresence>
      {summary && (
        <motion.div
          key="local-inference-pill"
          initial={{ opacity: 0, y: enterY }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: enterY }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="hidden items-center gap-2 rounded-md border border-border/70 bg-secondary/35 px-2.5 py-1 lg:flex"
        >
          {summary.state === 'loading' || summary.state === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
          ) : (
            <Cpu className="h-3.5 w-3.5 text-orange-500" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-none">{getStateLabel(summary)}</div>
            <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
              {detailParts.join(' | ')}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
