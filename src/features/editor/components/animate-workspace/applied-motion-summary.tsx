import { memo } from 'react'
import type { TextMotionEffect, TextMotionSlot } from '@/types/text-motion'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { getTextMotionPreset } from '@/shared/typography/text-motion'
import { AppliedContinuousMotionControls } from './applied-continuous-motion-controls'
import { AppliedMotionRow } from './applied-motion-row'
import type {
  KeyframeApplicationSummary,
  ManualKeyframeSummary,
} from './motion-clip-summary'

/** One live text-motion slot applied to the selected clip. */
export interface ActiveTextMotionEntry {
  slot: TextMotionSlot
  effect: TextMotionEffect
}

interface AppliedMotionSummaryProps {
  /** `panel` is the sidebar section; `edit` is the clip-level card. */
  variant: 'panel' | 'edit'
  manualKeyframeSummary: ManualKeyframeSummary
  /** Trimmed-out keyframes (edit variant only; the panel hides them). */
  trimmedKeyframeCount: number
  keyframeApplications: KeyframeApplicationSummary[]
  activeTextMotion: ActiveTextMotionEntry[]
  selectedItems: TimelineItem[]
  canvas: CanvasSettings
  onRemoveManualKeyframes: () => void
  onTrimAnimation: () => void
  onRemovePresetApplication: (applicationId: string) => void
  onNavigateToItemFrame: (frame: number) => void
  onRemoveTextMotion: (slot: TextMotionSlot) => void
  onNavigateToTextMotion: (slot: TextMotionSlot) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * "Applied to this clip" summary — manual keyframes, generated keyframe
 * applications, live modulators and text motion, each removable. Shared by the
 * Motion sidebar and the Edit panel's compact card, so the two surfaces cannot
 * drift apart.
 */
export const AppliedMotionSummary = memo(function AppliedMotionSummary({
  variant,
  manualKeyframeSummary,
  trimmedKeyframeCount,
  keyframeApplications,
  activeTextMotion,
  selectedItems,
  canvas,
  onRemoveManualKeyframes,
  onTrimAnimation,
  onRemovePresetApplication,
  onNavigateToItemFrame,
  onRemoveTextMotion,
  onNavigateToTextMotion,
  t,
}: AppliedMotionSummaryProps) {
  const edit = variant === 'edit'
  const rows = (
    <>
      {manualKeyframeSummary.keyframeCount > 0 ? (
        <AppliedMotionRow
          label={t('editor.animateStages.manualKeyframes')}
          detail={`${manualKeyframeSummary.properties.join(', ')} · ${t('editor.animateStages.keyframeCount', { count: manualKeyframeSummary.keyframeCount })}`}
          removeLabel={t('editor.animateStages.removeManualKeyframes')}
          onRemove={onRemoveManualKeyframes}
          onNavigate={
            manualKeyframeSummary.firstFrame === null
              ? undefined
              : () => onNavigateToItemFrame(manualKeyframeSummary.firstFrame ?? 0)
          }
        />
      ) : null}
      {edit && trimmedKeyframeCount > 0 ? (
        <AppliedMotionRow
          label={t('timeline.keyframeEditor.trimmedKeyframesLabel')}
          detail={t('timeline.keyframeEditor.trimmedKeyframesDetail', {
            count: trimmedKeyframeCount,
          })}
          removeLabel={t('timeline.keyframeEditor.trimAnimation')}
          onRemove={onTrimAnimation}
        />
      ) : null}
      {keyframeApplications.map((application) => (
        <AppliedMotionRow
          key={application.source.applicationId}
          label={application.source.presetName}
          detail={
            edit
              ? `${t('editor.animateStages.generatedKeyframes')} · ${t('editor.animateStages.keyframeCount', { count: application.keyframeCount })}`
              : `${t('editor.animateStages.generatedKeyframes')} · ${[...application.properties].join(', ')} · ${t('editor.animateStages.keyframeCount', { count: application.keyframeCount })}`
          }
          removeLabel={t('editor.animateStages.removePresetApplication', {
            name: application.source.presetName,
          })}
          onRemove={() => onRemovePresetApplication(application.source.applicationId)}
          onNavigate={() => onNavigateToItemFrame(application.firstFrame)}
        />
      ))}
      <AppliedContinuousMotionControls
        items={selectedItems}
        canvas={canvas}
        variant="rows"
        showBakeAction={edit}
      />
      {activeTextMotion.map(({ slot, effect }) => (
        <AppliedMotionRow
          key={slot}
          label={t(getTextMotionPreset(effect.presetId).labelKey)}
          detail={`${t('editor.animateStages.scopeText')} · ${t(`textMotion.slots.${slot}`)} · ${t('editor.animateStages.liveBadge')}`}
          removeLabel={t('textMotion.removePreset', {
            name: t(getTextMotionPreset(effect.presetId).labelKey),
          })}
          onRemove={() => onRemoveTextMotion(slot)}
          onNavigate={() => onNavigateToTextMotion(slot)}
        />
      ))}
    </>
  )

  if (edit) {
    return (
      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-xs font-medium">{t('editor.animateStages.appliedTitle')}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t('editor.editAnimation.appliedHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-secondary/20 p-2">
          {rows}
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/60 bg-secondary/20 p-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t('editor.animateStages.appliedTitle')}
      </span>
      <div className="flex flex-col gap-1">{rows}</div>
    </section>
  )
})
