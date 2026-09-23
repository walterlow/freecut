import { memo } from 'react'
import { cn } from '@/shared/ui/cn'

export type MotionApplyMode = 'replace' | 'merge' | 'layer'

const APPLY_MODES: readonly MotionApplyMode[] = ['replace', 'merge', 'layer']

interface ApplyModeSelectorProps {
  mode: MotionApplyMode
  onChange: (mode: MotionApplyMode) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/** Replace / merge / layer switch for keyframe-preset applications. */
export const ApplyModeSelector = memo(function ApplyModeSelector({
  mode,
  onChange,
  t,
}: ApplyModeSelectorProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{t('editor.animateStages.onApply')}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border/60">
        {APPLY_MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => onChange(candidate)}
            className={cn(
              'px-2 py-0.5 text-[10px] font-medium',
              mode === candidate
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/40',
            )}
          >
            {t(`editor.animateStages.applyMode.${candidate}`)}
          </button>
        ))}
      </div>
    </div>
  )
})
