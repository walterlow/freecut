import type { ReactNode } from 'react'
import { cn } from '@/shared/ui/cn'

interface BackgroundTaskProgressProps {
  icon: ReactNode
  label: string
  progressAriaLabel: string
  progressPercent?: number | null
  indeterminate?: boolean
  meta?: ReactNode
  trailing?: ReactNode
  fillClassName: string
}

export function BackgroundTaskProgress({
  icon,
  label,
  progressAriaLabel,
  progressPercent = null,
  indeterminate = false,
  meta,
  trailing,
  fillClassName,
}: BackgroundTaskProgressProps) {
  const clampedPercent =
    progressPercent == null ? null : Math.max(0, Math.min(100, Math.round(progressPercent)))

  return (
    <div className="px-3 py-2 border-t border-border flex-shrink-0 bg-panel-bg/50">
      <div className="flex items-center gap-2 text-xs">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-muted-foreground truncate">{label}</span>
            {meta && <div className="flex items-center gap-2 text-muted-foreground">{meta}</div>}
          </div>
          <div
            role="progressbar"
            aria-label={progressAriaLabel}
            aria-valuemin={indeterminate ? undefined : 0}
            aria-valuemax={indeterminate ? undefined : 100}
            aria-valuenow={indeterminate || clampedPercent == null ? undefined : clampedPercent}
            className="h-1 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                fillClassName,
                indeterminate && 'w-1/3 animate-pulse',
              )}
              style={
                indeterminate || clampedPercent == null
                  ? undefined
                  : { width: `${clampedPercent}%` }
              }
            />
          </div>
        </div>
        {trailing}
      </div>
    </div>
  )
}
