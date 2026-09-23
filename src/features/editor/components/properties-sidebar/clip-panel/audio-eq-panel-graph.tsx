import { cn } from '@/shared/ui/cn'
import type { ResolvedAudioEqSettings } from '@/types/audio'
import { AudioEqCurveEditor, type AudioEqPatch } from './audio-eq-curve-editor'
import { EqOutputGainControl } from './audio-eq-panel-controls'

interface AudioEqPanelGraphProps {
  settings: ResolvedAudioEqSettings
  outputGainDb: number | 'mixed'
  disabled: boolean
  /** Detached panels stretch the curve graph, floating ones keep it compact. */
  detached: boolean
  compact: boolean
  /** Track panels do not show the selected-clip count badge. */
  trackMode: boolean
  clipCount: number
  onPatchLiveChange: (patch: AudioEqPatch) => void
  onPatchChange: (patch: AudioEqPatch) => void
  onFieldChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
}

/** Curve editor plus the output-gain fader sitting next to it. */
export function AudioEqPanelGraph({
  settings,
  outputGainDb,
  disabled,
  detached,
  compact,
  trackMode,
  clipCount,
  onPatchLiveChange,
  onPatchChange,
  onFieldChange,
}: AudioEqPanelGraphProps) {
  return (
    <div className={cn('relative', !compact && 'border-b border-border')}>
      {!trackMode && !compact ? (
        <div className="pointer-events-none absolute right-3 top-1 z-10 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {clipCount} {clipCount === 1 ? 'clip' : 'clips'}
        </div>
      ) : null}
      <div className="flex items-stretch gap-3 px-3 pb-3 pt-2">
        <div className="min-w-0 flex-1">
          <AudioEqCurveEditor
            settings={settings}
            disabled={disabled}
            className="text-zinc-300"
            graphClassName={cn(
              'bg-background',
              detached ? 'h-[clamp(288px,33vh,344px)]' : 'h-[220px]',
            )}
            onLiveChange={onPatchLiveChange}
            onChange={onPatchChange}
          />
        </div>
        {!compact ? (
          <EqOutputGainControl
            value={outputGainDb}
            disabled={disabled}
            compact={!detached}
            onLiveChange={(value) => onPatchLiveChange({ audioEqOutputGainDb: value })}
            onChange={(value) => onFieldChange('audioEqOutputGainDb', value)}
          />
        ) : null}
      </div>
    </div>
  )
}
