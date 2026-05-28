import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
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
  /** Optional per-item breakdown revealed via a disclosure toggle on the label. */
  details?: ReactNode
  /** Accessible label for the expand/collapse toggle. */
  detailsToggleAriaLabel?: string
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
  details,
  detailsToggleAriaLabel,
}: BackgroundTaskProgressProps) {
  const clampedPercent =
    progressPercent == null ? null : Math.max(0, Math.min(100, Math.round(progressPercent)))
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="px-3 py-2 border-t border-border flex-shrink-0 bg-panel-bg/50">
      <div className="flex items-center gap-2 text-xs">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            {details ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                aria-label={detailsToggleAriaLabel}
                className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight
                  className={cn(
                    'w-3 h-3 flex-shrink-0 transition-transform',
                    expanded && 'rotate-90',
                  )}
                />
                <span className="truncate">{label}</span>
              </button>
            ) : (
              <span className="text-muted-foreground truncate">{label}</span>
            )}
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
          {details && expanded && <div className="mt-2 space-y-1">{details}</div>}
        </div>
        {trailing}
      </div>
    </div>
  )
}
