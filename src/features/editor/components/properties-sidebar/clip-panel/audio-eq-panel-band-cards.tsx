import { cn } from '@/shared/ui/cn'
import { AUDIO_EQ_GAIN_DB_MAX, AUDIO_EQ_GAIN_DB_MIN } from '@/shared/utils/audio-eq'
import { AUDIO_EQ_Q_MAX, AUDIO_EQ_Q_MIN } from '@/shared/utils/audio-eq'
import { NumberInput } from '../components'
import { RotaryKnob } from '@/shared/ui/property-controls/rotary-knob'
import { formatFrequencyRangeLabel } from './audio-eq-panel-values'
import { bandShowsQ, type AudioEqBandView } from './audio-eq-panel-bands'
import type { AudioEqControlRangeId, AudioEqFilterType } from './audio-eq-ui'
import { BandCard, RangeButtons, SlopeButtons } from './audio-eq-panel-controls'
import type { AudioEqPatch } from './audio-eq-curve-editor'

/** Gain readout uses no sign for the (negative) minimum and a `+` above zero. */
const GAIN_MAX_LABEL =
  AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : String(AUDIO_EQ_GAIN_DB_MAX)

interface EqBandCardProps {
  view: AudioEqBandView
  /** Detached layout stretches the cards; the floating one packs them. */
  detached: boolean
  onFieldChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
  onFieldLiveChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
  onPatchChange: (patch: AudioEqPatch) => void
  onRangeChange: (view: AudioEqBandView, rangeId: AudioEqControlRangeId) => void
  portalContainer?: HTMLElement | null
}

type EqBandFieldProps = Pick<EqBandCardProps, 'view' | 'onFieldChange' | 'onFieldLiveChange'>

function EqBandFrequencyFields({ view, onFieldChange, onFieldLiveChange }: EqBandFieldProps) {
  return (
    <>
      <div className="text-[10px] text-zinc-500">Frequency</div>
      <div className="flex items-center gap-1.5">
        <NumberInput
          value={view.frequencyHz}
          onChange={(value) => onFieldChange(view.frequencyField, value)}
          onLiveChange={(value) => onFieldLiveChange(view.frequencyField, value)}
          unit="Hz"
          min={view.minFrequencyHz}
          max={view.maxFrequencyHz}
          step={1}
          className="flex-1"
        />
        <RotaryKnob
          value={view.frequencyHz}
          onChange={(value) => onFieldChange(view.frequencyField, value)}
          onLiveChange={(value) => onFieldLiveChange(view.frequencyField, value)}
          min={view.minFrequencyHz}
          max={view.maxFrequencyHz}
          step={1}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
        <span>{formatFrequencyRangeLabel(view.minFrequencyHz)}</span>
        <span>{formatFrequencyRangeLabel(view.maxFrequencyHz)}</span>
      </div>
    </>
  )
}

function EqBandGainFields({ view, onFieldChange, onFieldLiveChange }: EqBandFieldProps) {
  return (
    <>
      <div className="text-[10px] text-zinc-500">Gain</div>
      <div className="flex items-center gap-1.5">
        <NumberInput
          value={view.gainDb}
          onChange={(value) => onFieldChange(view.gainField, value)}
          onLiveChange={(value) => onFieldLiveChange(view.gainField, value)}
          unit="dB"
          min={AUDIO_EQ_GAIN_DB_MIN}
          max={AUDIO_EQ_GAIN_DB_MAX}
          step={0.1}
          className="flex-1"
        />
        <RotaryKnob
          value={view.gainDb}
          onChange={(value) => onFieldChange(view.gainField, value)}
          onLiveChange={(value) => onFieldLiveChange(view.gainField, value)}
          min={AUDIO_EQ_GAIN_DB_MIN}
          max={AUDIO_EQ_GAIN_DB_MAX}
          step={0.1}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
        <span>{GAIN_MAX_LABEL}</span>
      </div>
      {bandShowsQ(view.type) ? (
        <>
          <div className="text-[10px] text-zinc-500">Q Factor</div>
          <div className="flex items-center gap-1.5">
            <NumberInput
              value={view.q}
              onChange={(value) => onFieldChange(view.qField, value)}
              onLiveChange={(value) => onFieldLiveChange(view.qField, value)}
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
              className="flex-1"
            />
            <RotaryKnob
              value={view.q}
              onChange={(value) => onFieldChange(view.qField, value)}
              onLiveChange={(value) => onFieldLiveChange(view.qField, value)}
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
            <span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span>
            <span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span>
          </div>
        </>
      ) : null}
    </>
  )
}

/** Gain, Q and Q-slope region, or the cut-slope buttons the cut types use. */
function EqBandBody({
  view,
  onFieldChange,
  onFieldLiveChange,
  onRangeChange,
}: EqBandFieldProps & Pick<EqBandCardProps, 'onRangeChange'>) {
  const slope = view.slope
  if (view.hidden) return null
  if (slope) {
    return (
      <SlopeButtons value={slope.value} onChange={(value) => onFieldChange(slope.field, value)} />
    )
  }
  return (
    <>
      {view.rangeId ? (
        <RangeButtons value={view.rangeId} onChange={(rangeId) => onRangeChange(view, rangeId)} />
      ) : null}
      <EqBandGainFields
        view={view}
        onFieldChange={onFieldChange}
        onFieldLiveChange={onFieldLiveChange}
      />
    </>
  )
}

/** One band card: frequency row, then the band body. */
function EqBandCard({
  view,
  detached,
  onFieldChange,
  onFieldLiveChange,
  onPatchChange,
  onRangeChange,
  portalContainer,
}: EqBandCardProps) {
  return (
    <BandCard
      title={view.title}
      filterType={view.type}
      filterOptions={view.filterOptions}
      onFilterTypeChange={(value: AudioEqFilterType) =>
        onFieldChange(view.typeField, view.coerceFilterType(value))
      }
      portalContainer={portalContainer}
      compact={!detached}
      active={view.enabled}
      onToggle={() => onFieldChange(view.enabledField, !view.enabled)}
      onReset={() => onPatchChange(view.resetPatch)}
    >
      <EqBandFrequencyFields
        view={view}
        onFieldChange={onFieldChange}
        onFieldLiveChange={onFieldLiveChange}
      />
      <EqBandBody
        view={view}
        onFieldChange={onFieldChange}
        onFieldLiveChange={onFieldLiveChange}
        onRangeChange={onRangeChange}
      />
    </BandCard>
  )
}

interface AudioEqPanelGainBandsProps {
  views: AudioEqBandView[]
  detached: boolean
  disabled: boolean
  onFieldChange: EqBandCardProps['onFieldChange']
  onFieldLiveChange: EqBandCardProps['onFieldLiveChange']
  onPatchChange: EqBandCardProps['onPatchChange']
  onRangeChange: EqBandCardProps['onRangeChange']
  portalContainer?: HTMLElement | null
}

/** The six band cards, as laid out by the floating and detached panels. */
export function AudioEqPanelGainBands({
  views,
  detached,
  disabled,
  onFieldChange,
  onFieldLiveChange,
  onPatchChange,
  onRangeChange,
  portalContainer,
}: AudioEqPanelGainBandsProps) {
  return (
    <div
      className={cn(
        detached ? 'space-y-3 p-3' : 'space-y-2 p-2',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <div className={cn(detached && 'overflow-x-auto pb-1')}>
        <div
          className={cn(
            'grid',
            detached ? 'min-w-[1120px] grid-cols-6 gap-2' : 'grid-cols-6 gap-1',
          )}
        >
          {views.map((view) => (
            <EqBandCard
              key={view.key}
              view={view}
              detached={detached}
              onFieldChange={onFieldChange}
              onFieldLiveChange={onFieldLiveChange}
              onPatchChange={onPatchChange}
              onRangeChange={onRangeChange}
              portalContainer={portalContainer}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
