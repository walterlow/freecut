import { memo } from 'react'
import { ExternalLink, Layers3 } from 'lucide-react'
import type { TextMotionSlot } from '@/types/text-motion'
import type { TextItem, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import type { MotionPreset } from '@/features/editor/deps/keyframes'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/shared/ui/cn'
import { TextMotionSlotRows } from '../text-motion/text-motion-slot-rows'
import { MotionPresetThumbnail } from './motion-preset-thumbnail'
import {
  AppliedMotionSummary,
  type ActiveTextMotionEntry,
  type KeyframeApplicationSummary,
  type ManualKeyframeSummary,
} from './applied-motion-summary'

interface AnimationPresetLibraryEditProps {
  /** The compact quick-preset grid (six built-ins). */
  quickPresets: MotionPreset[]
  reasonFor: (preset: MotionPreset) => string | null
  onApplyPreset: (preset: MotionPreset) => void
  hasAnyAnimation: boolean
  manualKeyframeSummary: ManualKeyframeSummary
  trimmedKeyframeCount: number
  keyframeApplications: KeyframeApplicationSummary[]
  activeTextMotion: ActiveTextMotionEntry[]
  selectedItems: TimelineItem[]
  selectedTextItems: TextItem[]
  canvas: CanvasSettings
  onRemoveManualKeyframes: () => void
  onTrimAnimation: () => void
  onRemovePresetApplication: (applicationId: string) => void
  onNavigateToItemFrame: (frame: number) => void
  onRemoveTextMotion: (slot: TextMotionSlot) => void
  onNavigateToTextMotion: (slot: TextMotionSlot) => void
  isMotionClip: boolean
  onMotionClip: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * Clip-level animation surface (the Edit inspector's Motion area): the quick
 * preset grid, the applied-motion card, text-motion rows and the Motion-clip
 * bridge. The full library lives in animation-preset-library.tsx.
 */
export const AnimationPresetLibraryEdit = memo(function AnimationPresetLibraryEdit({
  quickPresets,
  reasonFor,
  onApplyPreset,
  hasAnyAnimation,
  manualKeyframeSummary,
  trimmedKeyframeCount,
  keyframeApplications,
  activeTextMotion,
  selectedItems,
  selectedTextItems,
  canvas,
  onRemoveManualKeyframes,
  onTrimAnimation,
  onRemovePresetApplication,
  onNavigateToItemFrame,
  onRemoveTextMotion,
  onNavigateToTextMotion,
  isMotionClip,
  onMotionClip,
  t,
}: AnimationPresetLibraryEditProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-4" data-testid="edit-animation-panel">
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-xs font-medium">{t('editor.editAnimation.quickTitle')}</h3>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              {t('editor.editAnimation.quickHint')}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {quickPresets.map((preset) => {
              const disabledReason = reasonFor(preset)
              const label = t(`editor.motionPresets.items.${preset.labelKey}`)
              return (
                <Tooltip key={preset.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={disabledReason !== null}
                      onClick={() => onApplyPreset(preset)}
                      className={cn(
                        'group flex min-h-14 flex-col items-center gap-1 rounded-md border border-border/60 p-1.5 text-[10px]',
                        disabledReason
                          ? 'cursor-not-allowed text-muted-foreground/40'
                          : 'text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
                      )}
                    >
                      <MotionPresetThumbnail thumbnail={preset.thumbnail} />
                      <span className="w-full truncate text-center">{label}</span>
                    </button>
                  </TooltipTrigger>
                  {disabledReason ? <TooltipContent>{disabledReason}</TooltipContent> : null}
                </Tooltip>
              )
            })}
          </div>
        </section>

        {hasAnyAnimation ? (
          <>
            <Separator />
            <AppliedMotionSummary
              variant="edit"
              manualKeyframeSummary={manualKeyframeSummary}
              trimmedKeyframeCount={trimmedKeyframeCount}
              keyframeApplications={keyframeApplications}
              activeTextMotion={activeTextMotion}
              selectedItems={selectedItems}
              canvas={canvas}
              onRemoveManualKeyframes={onRemoveManualKeyframes}
              onTrimAnimation={onTrimAnimation}
              onRemovePresetApplication={onRemovePresetApplication}
              onNavigateToItemFrame={onNavigateToItemFrame}
              onRemoveTextMotion={onRemoveTextMotion}
              onNavigateToTextMotion={onNavigateToTextMotion}
              t={t}
            />
          </>
        ) : null}

        {selectedTextItems.length > 0 ? (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <div>
                <h3 className="text-xs font-medium">{t('textMotion.sectionTitle')}</h3>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {t('editor.editAnimation.textHint')}
                </p>
              </div>
              <TextMotionSlotRows items={selectedTextItems} />
            </section>
          </>
        ) : null}

        <Separator />

        <section className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <div className="flex items-start gap-2">
            <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-medium">{t('editor.editAnimation.motionClipTitle')}</h3>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {isMotionClip
                  ? t('editor.editAnimation.motionClipOpenHint')
                  : t('editor.editAnimation.motionClipCreateHint')}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-7 gap-1.5 px-2 text-[10px]"
                onClick={onMotionClip}
              >
                {isMotionClip ? (
                  <ExternalLink className="h-3 w-3" />
                ) : (
                  <Layers3 className="h-3 w-3" />
                )}
                {isMotionClip
                  ? t('editor.editAnimation.openInMotion')
                  : t('editor.editAnimation.createMotionClip')}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </TooltipProvider>
  )
})
