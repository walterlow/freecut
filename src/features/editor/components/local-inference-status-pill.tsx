import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Loader2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  formatEstimatedBytes,
  getLocalInferenceSummary,
  useLocalInferenceStore,
} from '@/shared/state/local-inference'

export function LocalInferenceStatusPill() {
  const { t } = useTranslation()
  const runtimesById = useLocalInferenceStore((state) => state.runtimesById)
  const summary = useMemo(() => getLocalInferenceSummary(runtimesById), [runtimesById])
  const prefersReducedMotion = useReducedMotion()
  const enterY = prefersReducedMotion ? 0 : -4

  function getStateLabel(state: 'loading' | 'running' | 'ready' | 'error'): string {
    switch (state) {
      case 'loading':
        return t('editor.localInferencePill.loading')
      case 'running':
        return t('editor.localInferencePill.active')
      case 'error':
        return t('editor.localInferencePill.error')
      case 'ready':
        return t('editor.localInferencePill.ready')
    }
  }

  const detailParts = summary
    ? [
        summary.primaryLabel,
        summary.backendLabel,
        summary.activeJobs > 0
          ? t('editor.localInferencePill.jobs', { count: summary.activeJobs })
          : null,
        formatEstimatedBytes(summary.totalEstimatedBytes),
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
            <div className="text-[10px] font-medium leading-none">
              {getStateLabel(summary.state)}
            </div>
            <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
              {detailParts.join(' | ')}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
