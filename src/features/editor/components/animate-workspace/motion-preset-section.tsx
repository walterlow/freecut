import { memo } from 'react'
import { cn } from '@/shared/ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type MotionPreset,
  type MotionPresetCategory,
} from '@/features/editor/deps/keyframes'
import { MotionPresetThumbnail } from './motion-preset-thumbnail'

interface MotionPresetSectionProps {
  category: MotionPresetCategory
  presets: MotionPreset[]
  reasonFor: (preset: MotionPreset) => string | null
  onApply: (preset: MotionPreset) => void
  showHeading?: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

/** One category of built-in motion presets, rendered as an animated icon grid. */
export const MotionPresetSection = memo(function MotionPresetSection({
  category,
  presets,
  reasonFor,
  onApply,
  showHeading = true,
  t,
}: MotionPresetSectionProps) {
  return (
    <section className="flex flex-col gap-1.5">
      {showHeading ? (
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t(`editor.motionPresets.categories.${category}`)}
        </h3>
      ) : null}
      <div className="grid grid-cols-3 gap-1.5">
        {presets.map((preset) => {
          const reason = reasonFor(preset)
          const disabled = reason !== null
          const label = t(`editor.motionPresets.items.${preset.labelKey}`)

          return (
            <Tooltip key={preset.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={disabled}
                  onClick={() => {
                    if (!disabled) onApply(preset)
                  }}
                  className={cn(
                    'group flex min-h-16 w-full flex-col items-center gap-1 rounded-md border border-border/60 p-1.5 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    disabled
                      ? 'cursor-not-allowed text-muted-foreground/50'
                      : 'text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
                  )}
                >
                  <MotionPresetThumbnail thumbnail={preset.thumbnail} />
                  <span className="w-full truncate text-center leading-tight">{label}</span>
                </button>
              </TooltipTrigger>
              {reason && <TooltipContent>{reason}</TooltipContent>}
            </Tooltip>
          )
        })}
      </div>
    </section>
  )
})
