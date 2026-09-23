import { memo, useCallback, useState } from 'react'
import { SliderInput } from '@/shared/ui/property-controls'
import {
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  type MotionGeneratorSettings,
} from '@/features/editor/deps/keyframes'

export const MotionPresetControls = memo(function MotionPresetControls({
  onSettingsChange,
  t,
}: {
  onSettingsChange: (settings: MotionGeneratorSettings) => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const [settings, setSettings] = useState<MotionGeneratorSettings>(() => ({
    ...DEFAULT_MOTION_GENERATOR_SETTINGS,
  }))
  const update = useCallback(
    (partial: Partial<MotionGeneratorSettings>) => {
      setSettings((current) => {
        const next = { ...current, ...partial }
        onSettingsChange(next)
        return next
      })
    },
    [onSettingsChange],
  )

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-secondary/20 p-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t('editor.animateStages.presetParameters')}
      </span>
      <span className="text-[9px] leading-snug text-muted-foreground">
        {t('editor.animateStages.presetParametersHint')}
      </span>
      <SliderInput
        label={t('editor.motionGenerator.duration')}
        value={settings.durationScale}
        min={0.25}
        max={3}
        step={0.05}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => update({ durationScale: value })}
        onLiveChange={(value) => update({ durationScale: value })}
      />
      <SliderInput
        label={t('editor.motionGenerator.intensity')}
        value={settings.intensityScale}
        min={0}
        max={2}
        step={0.05}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => update({ intensityScale: value })}
        onLiveChange={(value) => update({ intensityScale: value })}
      />
      <SliderInput
        label={t('textMotion.stagger')}
        value={settings.staggerFrames}
        min={0}
        max={30}
        step={1}
        formatValue={(value) => `${Math.round(value)}f`}
        onChange={(value) => update({ staggerFrames: Math.round(value) })}
        onLiveChange={(value) => update({ staggerFrames: Math.round(value) })}
      />
    </div>
  )
})
