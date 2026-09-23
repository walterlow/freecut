import { memo } from 'react'
import { Trash2 } from 'lucide-react'
import type { MotionModifierChannel, MotionModifierChannelGains } from '@/types/motion'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SliderInput } from '@/shared/ui/property-controls'
import type { MotionModulator } from '@/features/editor/deps/keyframes'
import { MotionPresetThumbnail } from './motion-preset-thumbnail'

export interface ModifierEditSettings {
  intensityScale?: number
  durationScale?: number
  channelGains?: MotionModifierChannelGains
}

interface ContinuousMotionRowProps {
  modulator: MotionModulator
  active: boolean
  /** Disabled reason (incompatible selection) or null. */
  reason: string | null
  /** Live settings of the applied modifier (seeds the flyout sliders). */
  settings: {
    intensityScale: number
    durationScale: number
    channelGains: MotionModifierChannelGains
  } | null
  onApply: () => void
  onRemove: () => void
  onLiveEdit: (settings: ModifierEditSettings) => void
  onCommitEdit: (settings: ModifierEditSettings) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * One continuous-motion generator, rendered as an animated tile (the glyph
 * demonstrates the motion on hover, mirroring the keyframe-preset grid). Not
 * applied → click applies it with sensible defaults. Applied → the tile is a
 * flyout (popover) whose Intensity/Duration sliders tune the LIVE modifier on
 * the clip (preview updates as you drag, one undo per gesture) and remove it. No
 * tuning happens before applying.
 */
export const ContinuousMotionRow = memo(function ContinuousMotionRow({
  modulator,
  active,
  reason,
  settings,
  onApply,
  onRemove,
  onLiveEdit,
  onCommitEdit,
  t,
}: ContinuousMotionRowProps) {
  const label = t(`editor.motionGenerator.modulators.${modulator.labelKey}`)
  const tileBody = (
    <>
      <MotionPresetThumbnail thumbnail={modulator.thumbnail} />
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </>
  )

  if (!active) {
    const tile = (
      <button
        type="button"
        disabled={reason !== null}
        onClick={onApply}
        className={cn(
          'group flex h-full w-full flex-col items-center gap-1 rounded-md border border-border/60 p-1.5 text-[10px]',
          reason !== null
            ? 'cursor-not-allowed text-muted-foreground/50'
            : 'text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
        )}
      >
        {tileBody}
      </button>
    )
    if (!reason) return tile
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{tile}</div>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    )
  }

  const intensity = settings?.intensityScale ?? 1
  const duration = settings?.durationScale ?? 1
  const channelGain = (channel: MotionModifierChannel) => settings?.channelGains[channel] ?? 1

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('editor.animateStages.liveBadge') + ' — ' + label}
          className="group relative flex h-full w-full flex-col items-center gap-1 rounded-md border border-primary/60 bg-secondary/30 p-1.5 text-[10px] text-foreground hover:bg-secondary/50"
        >
          {/* Active dot — the tile is "live"; the flyout holds the controls. */}
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary shadow ring-1 ring-background" />
          {tileBody}
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-56 space-y-2 p-2">
        <div className="text-[11px] font-medium text-foreground">{label}</div>
        <div className="flex flex-col gap-1.5">
          <SliderInput
            label={t('editor.motionGenerator.intensity')}
            value={intensity}
            min={0}
            max={2}
            step={0.05}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onCommitEdit({ intensityScale: v })}
            onLiveChange={(v) => onLiveEdit({ intensityScale: v })}
          />
          <SliderInput
            label={t('editor.motionGenerator.duration')}
            value={duration}
            min={0.25}
            max={3}
            step={0.05}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onCommitEdit({ durationScale: v })}
            onLiveChange={(v) => onLiveEdit({ durationScale: v })}
          />
        </div>
        <Separator />
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('timeline.keyframeEditor.parameters')}
          </div>
          {modulator.properties.map((property) => (
            <SliderInput
              key={property}
              label={t(`keyframes.properties.${property}`)}
              value={channelGain(property)}
              min={0}
              max={2}
              step={0.05}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => onCommitEdit({ channelGains: { [property]: value } })}
              onLiveChange={(value) => onLiveEdit({ channelGains: { [property]: value } })}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('editor.motionGenerator.removeAction')}
        </Button>
      </PopoverContent>
    </Popover>
  )
})
