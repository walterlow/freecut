import { cn } from '@/shared/ui/cn'
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_Q_MAX,
  AUDIO_EQ_Q_MIN,
} from '@/shared/utils/audio-eq'
import { NumberInput } from '../components'
import { FilterTypeSelect } from './audio-eq-panel-controls'
import { bandShowsGain, bandShowsQ, type AudioEqBandView } from './audio-eq-panel-bands'
import type { AudioEqPatch } from './audio-eq-curve-editor'

interface CompactBandRowsProps {
  views: AudioEqBandView[]
  disabled: boolean
  onFieldChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
  onFieldLiveChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
  portalContainer?: HTMLElement | null
}

/** Six bands as aligned rows of toggle, filter type, frequency, gain and Q. */
export function CompactBandRows({
  views,
  disabled,
  onFieldChange,
  onFieldLiveChange,
  portalContainer,
}: CompactBandRowsProps) {
  const anyGain = views.some((view) => bandShowsGain(view.type))
  const anyQ = views.some((view) => bandShowsQ(view.type))

  return (
    <div className={cn(disabled && 'pointer-events-none opacity-40')}>
      <div className="space-y-1 px-2 pb-2">
        <div className="grid grid-cols-6 gap-1">
          {views.map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => onFieldChange(view.enabledField, !view.enabled)}
              className={cn(
                'h-7 rounded-[4px] border text-[11px] font-semibold transition-colors',
                view.enabled
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary',
              )}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {views.map((view) => (
            <FilterTypeSelect
              key={view.key}
              value={view.type}
              options={view.filterOptions}
              onChange={(value) => onFieldChange(view.typeField, view.coerceFilterType(value))}
              portalContainer={portalContainer}
            />
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {views.map((view) => (
            <NumberInput
              key={view.key}
              value={view.frequencyHz}
              onChange={(value) => onFieldChange(view.frequencyField, value)}
              onLiveChange={(value) => onFieldLiveChange(view.frequencyField, value)}
              unit="Hz"
              min={view.minFrequencyHz}
              max={view.maxFrequencyHz}
              step={1}
            />
          ))}
        </div>
        {anyGain ? (
          <div className="grid grid-cols-6 gap-1">
            {views.map((view) => (
              <CompactGainCell
                key={view.key}
                view={view}
                onFieldChange={onFieldChange}
                onFieldLiveChange={onFieldLiveChange}
              />
            ))}
          </div>
        ) : null}
        {anyQ ? (
          <div className="grid grid-cols-6 gap-1">
            {views.map((view) => (
              <CompactQCell
                key={view.key}
                view={view}
                onFieldChange={onFieldChange}
                onFieldLiveChange={onFieldLiveChange}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

type CompactCellProps = Pick<CompactBandRowsProps, 'onFieldChange' | 'onFieldLiveChange'> & {
  view: AudioEqBandView
}

/** Gain cell of a compact row: an input for gain-carrying types, else a gap. */
function CompactGainCell({ view, onFieldChange, onFieldLiveChange }: CompactCellProps) {
  if (!bandShowsGain(view.type)) return <div />
  return (
    <NumberInput
      value={view.gainDb}
      onChange={(value) => onFieldChange(view.gainField, value)}
      onLiveChange={(value) => onFieldLiveChange(view.gainField, value)}
      unit="dB"
      min={AUDIO_EQ_GAIN_DB_MIN}
      max={AUDIO_EQ_GAIN_DB_MAX}
      step={0.1}
    />
  )
}

/** Q cell of a compact row: an input for peaking types, else a gap. */
function CompactQCell({ view, onFieldChange, onFieldLiveChange }: CompactCellProps) {
  if (!bandShowsQ(view.type)) return <div />
  return (
    <NumberInput
      value={view.q}
      onChange={(value) => onFieldChange(view.qField, value)}
      onLiveChange={(value) => onFieldLiveChange(view.qField, value)}
      unit="Q"
      min={AUDIO_EQ_Q_MIN}
      max={AUDIO_EQ_Q_MAX}
      step={0.05}
    />
  )
}
