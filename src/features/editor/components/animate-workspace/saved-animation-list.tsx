import { memo } from 'react'
import { Trash2 } from 'lucide-react'
import type { AnimationPreset } from '@/infrastructure/storage'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/shared/ui/cn'

interface SavedAnimationListProps {
  /** Every saved preset (an empty list renders the empty-state copy). */
  presets: AnimationPreset[]
  /** Presets surviving the search / compatible-only filters. */
  visiblePresets: AnimationPreset[]
  filtersActive: boolean
  /** Whether any preset, modulator or text-motion row matches the filters. */
  hasVisibleResults: boolean
  reasonFor: (preset: AnimationPreset) => string | null
  onApply: (preset: AnimationPreset) => void
  onDelete: (preset: AnimationPreset) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * The no-match notice, separator and saved-animation list that close the
 * library's scroll area. Filtering hides the saved section entirely (its
 * presets are not part of the built-in catalogue the user is searching).
 */
export const SavedAnimationList = memo(function SavedAnimationList({
  presets,
  visiblePresets,
  filtersActive,
  hasVisibleResults,
  reasonFor,
  onApply,
  onDelete,
  t,
}: SavedAnimationListProps) {
  const showList = !filtersActive || visiblePresets.length > 0
  return (
    <>
      {!hasVisibleResults && filtersActive ? (
        <div
          className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground"
          role="status"
        >
          {t('editor.animatePresets.noMatches')}
        </div>
      ) : null}

      {showList ? <Separator /> : null}

      {/* ── Saved animations — user-captured presets, also declarative ── */}
      {showList ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('editor.animatePresets.animationsHeading')}
          </h3>
          {presets.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('editor.animatePresets.empty')}</p>
          ) : (
            visiblePresets.map((preset) => {
              const reason = reasonFor(preset)
              const disabled = reason !== null
              const row = (
                <div
                  key={preset.id}
                  className="group flex items-center gap-1 rounded-md border border-border/60"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-disabled={disabled}
                        onClick={() => {
                          if (!disabled) onApply(preset)
                        }}
                        className={cn(
                          'min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                          disabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'hover:bg-secondary/40',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                          {preset.motionModifiers?.length || preset.textMotion ? (
                            <span
                              className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
                              title={t('editor.animateStages.liveBadge')}
                            >
                              ƒx
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </TooltipTrigger>
                    {reason ? <TooltipContent>{reason}</TooltipContent> : null}
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={t('editor.animatePresets.deleteLabel')}
                    onClick={() => void onDelete(preset)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )

              return row
            })
          )}
        </section>
      ) : null}
    </>
  )
})
