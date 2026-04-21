import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/shared/ui/cn';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore } from '@/features/editor/deps/preview';
import { type TimelineItem } from '@/types/timeline';
import { NumberInput } from '../components';
import { RotaryKnob } from '@/shared/ui/property-controls/rotary-knob';
import { getMixedValue } from '../utils/mixed-value';
import { AudioEqCurveEditor, type AudioEqPatch } from './audio-eq-curve-editor';
import { getAudioSectionItems } from './audio-section-utils';
import {
  AUDIO_EQ_CONTROL_RANGES,
  buildTimelineEqPatchFromResolvedSettings,
  clampFrequencyToAudioEqControlRange,
  getAudioEqControlRangeById,
  inferAudioEqControlRangeId,
  normalizeUiEqPatch,
  toTimelineEqPatch,
  type AudioEqControlRangeId,
} from './audio-eq-ui';
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_PRESETS,
  AUDIO_EQ_Q_MAX,
  AUDIO_EQ_Q_MIN,
  type AudioEqPresetId,
  findAudioEqPresetId,
  getAudioEqPresetById,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq';

const AUDIO_EQ_SLOPE_OPTIONS = [6, 12, 18, 24] as const;
type GainBandControlKey = 'low' | 'lowMid' | 'highMid' | 'high';
type GainBandControlRanges = Record<GainBandControlKey, AudioEqControlRangeId>;

const DEFAULT_GAIN_BAND_CONTROL_RANGES = {
  low: 'L',
  lowMid: 'ML',
  highMid: 'MH',
  high: 'H',
} satisfies GainBandControlRanges;

interface AudioEqPanelContentProps {
  targetLabel: string;
  items?: TimelineItem[];
  trackEq?: import('@/types/audio').AudioEqSettings;
  enabled?: boolean;
  onTrackEqChange?: (patch: AudioEqPatch) => void;
  onEnabledChange?: (enabled: boolean) => void;
  portalContainer?: HTMLElement | null;
  layoutMode?: 'floating' | 'detached' | 'compact';
}

type FilterType = 'low-shelf' | 'peaking' | 'high-shelf' | 'high-pass' | 'low-pass' | 'notch';

const FILTER_TYPE_PATHS: Record<FilterType, string> = {
  'high-pass': 'M2 10 C5 10 7 3 10 3 L18 3',
  'low-shelf': 'M2 9 L5 9 C7 9 8 3 10 3 L18 3',
  'peaking': 'M2 8 C5 8 7 2 10 2 C13 2 15 8 18 8',
  'notch': 'M2 6 C7 6 8.4 10 10 10 C11.6 10 13 6 18 6',
  'high-shelf': 'M2 3 L8 3 C10 3 11 9 13 9 L18 9',
  'low-pass': 'M2 3 L8 3 C11 3 13 10 16 10 L18 10',
};

const FILTER_TYPE_LABELS: Record<FilterType, string> = {
  'high-pass': 'High Pass',
  'low-shelf': 'Low Shelf',
  'peaking': 'Peaking',
  'notch': 'Notch',
  'high-shelf': 'High Shelf',
  'low-pass': 'Low Pass',
};

const BAND1_FILTER_OPTIONS = ['low-shelf', 'peaking', 'high-shelf', 'high-pass'] as const satisfies ReadonlyArray<FilterType>;
const INNER_FILTER_OPTIONS = ['low-shelf', 'peaking', 'high-shelf', 'notch'] as const satisfies ReadonlyArray<FilterType>;
const BAND6_FILTER_OPTIONS = ['low-pass', 'low-shelf', 'peaking', 'high-shelf'] as const satisfies ReadonlyArray<FilterType>;

function FilterTypeGlyph({ type }: { type: FilterType }) {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5 text-current">
      <path
        d={FILTER_TYPE_PATHS[type]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilterTypeSelect({
  value,
  options,
  onChange,
  portalContainer,
}: {
  value: FilterType;
  options: ReadonlyArray<FilterType>;
  onChange: (value: FilterType) => void;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-11 items-center justify-center gap-0.5 rounded-[4px] border border-border bg-background px-1 text-muted-foreground transition-colors hover:text-zinc-200"
          title={FILTER_TYPE_LABELS[value]}
        >
          <FilterTypeGlyph type={value} />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={4}
        container={portalContainer ?? undefined}
        className="z-[80] w-14 min-w-14 rounded-[4px] border-border bg-background p-1"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            className={cn(
              'my-0.5 flex h-7 items-center justify-center rounded-[4px] px-2 text-zinc-300 focus:bg-white/10 focus:text-white',
              option === value && 'bg-white/10 text-white',
            )}
            title={FILTER_TYPE_LABELS[option]}
            onSelect={() => onChange(option)}
          >
            <FilterTypeGlyph type={option} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SlopeButtons({
  value,
  onChange,
}: {
  value: number | 'mixed';
  onChange: (v: 6 | 12 | 18 | 24) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[4px] border border-border/70">
      {AUDIO_EQ_SLOPE_OPTIONS.map((slope) => (
        <button
          key={slope}
          type="button"
          className={cn(
            'flex-1 border-r border-border/70 py-1 text-[10px] font-medium transition-colors last:border-r-0',
            value === slope
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          )}
          onClick={() => onChange(slope)}
        >
          {slope}
        </button>
      ))}
    </div>
  );
}

function formatFrequencyRangeLabel(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    return `${(frequencyHz / 1000).toFixed(1)}K`;
  }
  return `${Math.round(frequencyHz)}`;
}

function RangeButtons({
  value,
  onChange,
}: {
  value: AudioEqControlRangeId;
  onChange: (value: AudioEqControlRangeId) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[4px] border border-border/70">
      {AUDIO_EQ_CONTROL_RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          className={cn(
            'flex-1 border-r border-border/70 py-1 text-[10px] font-medium transition-colors last:border-r-0',
            value === range.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          )}
          onClick={() => onChange(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

function getEffectiveGainBandControlRangeId(
  selectedRangeId: AudioEqControlRangeId,
  frequencyHz: number | 'mixed',
  preferredRangeId: AudioEqControlRangeId,
): AudioEqControlRangeId {
  if (frequencyHz === 'mixed') return preferredRangeId;
  const selectedRange = getAudioEqControlRangeById(selectedRangeId);
  if (frequencyHz >= selectedRange.minFrequencyHz && frequencyHz <= selectedRange.maxFrequencyHz) {
    return selectedRangeId;
  }
  return inferAudioEqControlRangeId(frequencyHz, preferredRangeId);
}

function clampOutputGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(AUDIO_EQ_GAIN_DB_MIN, Math.min(AUDIO_EQ_GAIN_DB_MAX, value));
}

function roundOutputGainDb(value: number): number {
  return Math.round(clampOutputGainDb(value) * 10) / 10;
}

function formatOutputGainDb(value: number | 'mixed'): string {
  if (value === 'mixed') return 'Mixed';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

interface EqOutputGainControlProps {
  value: number | 'mixed';
  onChange: (value: number) => void;
  onLiveChange: (value: number) => void;
  disabled?: boolean;
  compact?: boolean;
}

function EqOutputGainControl({
  value,
  onChange,
  onLiveChange,
  disabled = false,
  compact = false,
}: EqOutputGainControlProps) {
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const resolvedValue = value === 'mixed' ? 0 : value;
  const displayValue = draftValue ?? resolvedValue;
  const range = AUDIO_EQ_GAIN_DB_MAX - AUDIO_EQ_GAIN_DB_MIN;
  const thumbPercent = (1 - ((displayValue - AUDIO_EQ_GAIN_DB_MIN) / Math.max(range, 1))) * 100;

  const valueFromClientY = useCallback((clientY: number, rect: DOMRect) => {
    const normalized = 1 - ((clientY - rect.top) / Math.max(rect.height, 1));
    return roundOutputGainDb(AUDIO_EQ_GAIN_DB_MIN + Math.max(0, Math.min(1, normalized)) * range);
  }, [range]);

  const commitValue = useCallback((nextValue: number) => {
    setDraftValue(null);
    onChange(roundOutputGainDb(nextValue));
  }, [onChange]);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col px-1 pb-1 pt-1',
        compact ? 'w-[68px] h-[220px]' : 'w-[76px] h-[clamp(288px,33vh,344px)]',
        disabled && 'opacity-50',
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 text-center">
        Gain
      </div>
      <div
        className={cn('relative mt-1 min-h-0 flex-1 w-full touch-none select-none', disabled ? 'pointer-events-none' : 'cursor-ns-resize')}
        onDoubleClick={() => {
          if (disabled) return;
          setDraftValue(null);
          onLiveChange(0);
          onChange(0);
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          const target = event.currentTarget;
          const rect = target.getBoundingClientRect();
          const startValue = valueFromClientY(event.clientY, rect);
          target.setPointerCapture?.(event.pointerId);
          setDraftValue(startValue);
          onLiveChange(startValue);

          const handlePointerMove = (moveEvent: PointerEvent) => {
            const nextValue = valueFromClientY(moveEvent.clientY, rect);
            setDraftValue(nextValue);
            onLiveChange(nextValue);
          };

          const handlePointerEnd = (endEvent: PointerEvent) => {
            target.releasePointerCapture?.(event.pointerId);
            const nextValue = valueFromClientY(endEvent.clientY, rect);
            target.removeEventListener('pointermove', handlePointerMove);
            target.removeEventListener('pointerup', handlePointerEnd);
            target.removeEventListener('pointercancel', handlePointerEnd);
            commitValue(nextValue);
          };

          target.addEventListener('pointermove', handlePointerMove);
          target.addEventListener('pointerup', handlePointerEnd);
          target.addEventListener('pointercancel', handlePointerEnd);
        }}
      >
        <div className="absolute inset-x-0 top-0 bottom-7">
          {[20, 10, 0, -10, -20].map((tick) => {
            const tickPercent = (1 - ((tick - AUDIO_EQ_GAIN_DB_MIN) / Math.max(range, 1))) * 100;
            return (
              <div
                key={tick}
                className="pointer-events-none absolute inset-x-0"
                style={{ top: `${tickPercent}%` }}
              >
                <div className="absolute left-2 right-7 h-px -translate-y-1/2 bg-[#34363d]" />
                <span className="absolute right-1 -translate-y-1/2 text-[9px] font-mono text-zinc-500 text-right">
                  {tick > 0 ? `+${tick}` : tick}
                </span>
              </div>
            );
          })}
          <div className="absolute bottom-0 left-[16px] top-0 w-px bg-[#2f3138]" />
          <div
            className="absolute left-[7px] h-7 w-[18px] -translate-y-1/2 rounded-[2px] border border-[#666a73] bg-[#b9bbc2] shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            style={{ top: `${thumbPercent}%` }}
          />
        </div>
      </div>
      <div className="mt-0.5 min-h-[18px] w-full text-center text-sm font-medium tabular-nums text-[#16d9ff]">
        {formatOutputGainDb(displayValue)}
      </div>
    </div>
  );
}

interface BandCardProps {
  title: string;
  filterType: FilterType;
  filterOptions?: ReadonlyArray<FilterType>;
  onFilterTypeChange?: (value: FilterType) => void;
  portalContainer?: HTMLElement | null;
  compact?: boolean;
  active?: boolean;
  onToggle?: () => void;
  onReset: () => void;
  children: ReactNode;
}

function BandCard({
  title,
  filterType,
  filterOptions,
  onFilterTypeChange,
  portalContainer,
  compact = false,
  active = true,
  onToggle,
  onReset,
  children,
}: BandCardProps) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-[6px] border border-border bg-secondary/50 transition-opacity',
        !active && onToggle && 'opacity-50',
      )}
    >
      <div className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border',
        compact ? 'gap-1 px-1.5 py-1.5' : 'gap-1.5 px-2 py-2',
      )}>
        <div className={cn('flex min-w-0 items-center overflow-hidden', compact ? 'gap-1' : 'gap-1.5')}>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full py-0.5 text-[9px] font-semibold leading-none transition-colors',
                compact ? 'min-w-[3.05rem] px-1' : 'min-w-[3.55rem] px-1.5',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              {title}
            </button>
          ) : (
            <span className={cn(
              'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary py-0.5 text-[9px] font-semibold leading-none text-primary-foreground',
              compact ? 'min-w-[3.05rem] px-1' : 'min-w-[3.55rem] px-1.5',
            )}>
              {title}
            </span>
          )}
          <div className="shrink-0">
            {filterOptions && onFilterTypeChange ? (
              <FilterTypeSelect
                value={filterType}
                options={filterOptions}
                onChange={onFilterTypeChange}
                portalContainer={portalContainer}
              />
            ) : (
              <div className="flex h-6 items-center rounded-[4px] border border-border bg-background px-1.5 text-muted-foreground">
                <FilterTypeGlyph type={filterType} />
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-[3px] text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300',
            compact ? 'h-4 w-4' : 'h-5 w-5',
          )}
          onClick={onReset}
          aria-label={`Reset ${title}`}
          title={`Reset ${title}`}
        >
          <RotateCcw className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
        </button>
      </div>
      <div className={cn('flex flex-1 flex-col', compact ? 'gap-1.5 p-1.5' : 'gap-2 p-2')}>
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact row-based band controls (Davinci-style)
// ---------------------------------------------------------------------------

type CompactBandRowsProps = {
  eqBand1Type: FilterType | 'mixed'; eqBand1Enabled: boolean | 'mixed'; eqBand1FrequencyHz: number | 'mixed'; eqBand1GainDb: number | 'mixed'; eqBand1Q: number | 'mixed';
  eqLowType: FilterType | 'mixed'; eqLowEnabled: boolean | 'mixed'; eqLowFrequencyHz: number | 'mixed'; eqLow: number | 'mixed'; eqLowQ: number | 'mixed'; lowRange: { minFrequencyHz: number; maxFrequencyHz: number };
  eqLowMidType: FilterType | 'mixed'; eqLowMidEnabled: boolean | 'mixed'; eqLowMidFrequencyHz: number | 'mixed'; eqLowMid: number | 'mixed'; eqLowMidQ: number | 'mixed'; lowMidRange: { minFrequencyHz: number; maxFrequencyHz: number };
  eqHighMidType: FilterType | 'mixed'; eqHighMidEnabled: boolean | 'mixed'; eqHighMidFrequencyHz: number | 'mixed'; eqHighMid: number | 'mixed'; eqHighMidQ: number | 'mixed'; highMidRange: { minFrequencyHz: number; maxFrequencyHz: number };
  eqHighType: FilterType | 'mixed'; eqHighEnabled: boolean | 'mixed'; eqHighFrequencyHz: number | 'mixed'; eqHigh: number | 'mixed'; eqHighQ: number | 'mixed'; highRange: { minFrequencyHz: number; maxFrequencyHz: number };
  eqBand6Type: FilterType | 'mixed'; eqBand6Enabled: boolean | 'mixed'; eqBand6FrequencyHz: number | 'mixed'; eqBand6GainDb: number | 'mixed'; eqBand6Q: number | 'mixed';
  onFieldChange: <K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => void;
  onLiveChange: (patch: AudioEqPatch) => void;
  portalContainer?: HTMLElement | null;
};

function CompactBandRows(props: CompactBandRowsProps) {
  const { onFieldChange, onLiveChange, portalContainer } = props;
  const b1Type = (props.eqBand1Type === 'mixed' ? 'high-pass' : props.eqBand1Type) as FilterType;
  const b2Type = (props.eqLowType === 'mixed' ? 'low-shelf' : props.eqLowType) as FilterType;
  const b3Type = (props.eqLowMidType === 'mixed' ? 'peaking' : props.eqLowMidType) as FilterType;
  const b4Type = (props.eqHighMidType === 'mixed' ? 'peaking' : props.eqHighMidType) as FilterType;
  const b5Type = (props.eqHighType === 'mixed' ? 'high-shelf' : props.eqHighType) as FilterType;
  const b6Type = (props.eqBand6Type === 'mixed' ? 'low-pass' : props.eqBand6Type) as FilterType;
  const showGain = (t: FilterType) => t !== 'high-pass' && t !== 'low-pass' && t !== 'notch';
  const showQ = (t: FilterType) => t === 'peaking';
  const anyGain = showGain(b1Type) || showGain(b2Type) || showGain(b3Type) || showGain(b4Type) || showGain(b5Type) || showGain(b6Type);
  const anyQ = showQ(b1Type) || showQ(b2Type) || showQ(b3Type) || showQ(b4Type) || showQ(b5Type) || showQ(b6Type);

  return (
    <div className="space-y-1 px-2 pb-2">
      {/* Band toggle buttons */}
      <div className="grid grid-cols-6 gap-1">
        {([
          { label: 'B 1', active: props.eqBand1Enabled === 'mixed' ? false : props.eqBand1Enabled, field: 'audioEqBand1Enabled' as const, current: props.eqBand1Enabled },
          { label: 'B 2', active: props.eqLowEnabled === 'mixed' ? false : props.eqLowEnabled, field: 'audioEqLowEnabled' as const, current: props.eqLowEnabled },
          { label: 'B 3', active: props.eqLowMidEnabled === 'mixed' ? false : props.eqLowMidEnabled, field: 'audioEqLowMidEnabled' as const, current: props.eqLowMidEnabled },
          { label: 'B 4', active: props.eqHighMidEnabled === 'mixed' ? false : props.eqHighMidEnabled, field: 'audioEqHighMidEnabled' as const, current: props.eqHighMidEnabled },
          { label: 'B 5', active: props.eqHighEnabled === 'mixed' ? false : props.eqHighEnabled, field: 'audioEqHighEnabled' as const, current: props.eqHighEnabled },
          { label: 'B 6', active: props.eqBand6Enabled === 'mixed' ? false : props.eqBand6Enabled, field: 'audioEqBand6Enabled' as const, current: props.eqBand6Enabled },
        ] as const).map((band) => (
          <button key={band.label} type="button" onClick={() => onFieldChange(band.field, band.current === 'mixed' ? true : !band.current)}
            className={cn('h-7 rounded-[4px] border text-[11px] font-semibold transition-colors', band.active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary')}>
            {band.label}
          </button>
        ))}
      </div>
      {/* Filter type selectors */}
      <div className="grid grid-cols-6 gap-1">
        <FilterTypeSelect value={b1Type} options={BAND1_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqBand1Type', v as typeof BAND1_FILTER_OPTIONS[number])} portalContainer={portalContainer} />
        <FilterTypeSelect value={b2Type} options={INNER_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqLowType', v === 'low-pass' || v === 'high-pass' ? 'low-shelf' : v)} portalContainer={portalContainer} />
        <FilterTypeSelect value={b3Type} options={INNER_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqLowMidType', v === 'low-pass' || v === 'high-pass' ? 'peaking' : v)} portalContainer={portalContainer} />
        <FilterTypeSelect value={b4Type} options={INNER_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqHighMidType', v === 'low-pass' || v === 'high-pass' ? 'peaking' : v)} portalContainer={portalContainer} />
        <FilterTypeSelect value={b5Type} options={INNER_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqHighType', v === 'low-pass' || v === 'high-pass' ? 'high-shelf' : v)} portalContainer={portalContainer} />
        <FilterTypeSelect value={b6Type} options={BAND6_FILTER_OPTIONS} onChange={(v) => onFieldChange('audioEqBand6Type', v === 'high-pass' || v === 'notch' ? 'low-pass' : v)} portalContainer={portalContainer} />
      </div>
      {/* Frequency row */}
      <div className="grid grid-cols-6 gap-1">
        <NumberInput value={props.eqBand1FrequencyHz} onChange={(v) => onFieldChange('audioEqBand1FrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqBand1FrequencyHz: v })} unit="Hz" min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ} step={1} />
        <NumberInput value={props.eqLowFrequencyHz} onChange={(v) => onFieldChange('audioEqLowFrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqLowFrequencyHz: v })} unit="Hz" min={props.lowRange.minFrequencyHz} max={props.lowRange.maxFrequencyHz} step={1} />
        <NumberInput value={props.eqLowMidFrequencyHz} onChange={(v) => onFieldChange('audioEqLowMidFrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqLowMidFrequencyHz: v })} unit="Hz" min={props.lowMidRange.minFrequencyHz} max={props.lowMidRange.maxFrequencyHz} step={1} />
        <NumberInput value={props.eqHighMidFrequencyHz} onChange={(v) => onFieldChange('audioEqHighMidFrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqHighMidFrequencyHz: v })} unit="Hz" min={props.highMidRange.minFrequencyHz} max={props.highMidRange.maxFrequencyHz} step={1} />
        <NumberInput value={props.eqHighFrequencyHz} onChange={(v) => onFieldChange('audioEqHighFrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqHighFrequencyHz: v })} unit="Hz" min={props.highRange.minFrequencyHz} max={props.highRange.maxFrequencyHz} step={1} />
        <NumberInput value={props.eqBand6FrequencyHz} onChange={(v) => onFieldChange('audioEqBand6FrequencyHz', v)} onLiveChange={(v) => onLiveChange({ audioEqBand6FrequencyHz: v })} unit="Hz" min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ} step={1} />
      </div>
      {/* Gain row */}
      {anyGain ? (
        <div className="grid grid-cols-6 gap-1">
          {showGain(b1Type) ? <NumberInput value={props.eqBand1GainDb} onChange={(v) => onFieldChange('audioEqBand1GainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqBand1GainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
          {showGain(b2Type) ? <NumberInput value={props.eqLow} onChange={(v) => onFieldChange('audioEqLowGainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqLowGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
          {showGain(b3Type) ? <NumberInput value={props.eqLowMid} onChange={(v) => onFieldChange('audioEqLowMidGainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqLowMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
          {showGain(b4Type) ? <NumberInput value={props.eqHighMid} onChange={(v) => onFieldChange('audioEqHighMidGainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqHighMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
          {showGain(b5Type) ? <NumberInput value={props.eqHigh} onChange={(v) => onFieldChange('audioEqHighGainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqHighGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
          {showGain(b6Type) ? <NumberInput value={props.eqBand6GainDb} onChange={(v) => onFieldChange('audioEqBand6GainDb', v)} onLiveChange={(v) => onLiveChange({ audioEqBand6GainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} /> : <div />}
        </div>
      ) : null}
      {/* Q factor row */}
      {anyQ ? (
        <div className="grid grid-cols-6 gap-1">
          {showQ(b1Type) ? <NumberInput value={props.eqBand1Q} onChange={(v) => onFieldChange('audioEqBand1Q', v)} onLiveChange={(v) => onLiveChange({ audioEqBand1Q: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
          {showQ(b2Type) ? <NumberInput value={props.eqLowQ} onChange={(v) => onFieldChange('audioEqLowQ', v)} onLiveChange={(v) => onLiveChange({ audioEqLowQ: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
          {showQ(b3Type) ? <NumberInput value={props.eqLowMidQ} onChange={(v) => onFieldChange('audioEqLowMidQ', v)} onLiveChange={(v) => onLiveChange({ audioEqLowMidQ: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
          {showQ(b4Type) ? <NumberInput value={props.eqHighMidQ} onChange={(v) => onFieldChange('audioEqHighMidQ', v)} onLiveChange={(v) => onLiveChange({ audioEqHighMidQ: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
          {showQ(b5Type) ? <NumberInput value={props.eqHighQ} onChange={(v) => onFieldChange('audioEqHighQ', v)} onLiveChange={(v) => onLiveChange({ audioEqHighQ: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
          {showQ(b6Type) ? <NumberInput value={props.eqBand6Q} onChange={(v) => onFieldChange('audioEqBand6Q', v)} onLiveChange={(v) => onLiveChange({ audioEqBand6Q: v })} unit="Q" min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} /> : <div />}
        </div>
      ) : null}
    </div>
  );
}

export function AudioEqPanelContent({
  items,
  targetLabel,
  trackEq,
  enabled = true,
  onTrackEqChange,
  onEnabledChange,
  portalContainer,
  layoutMode = 'floating',
}: AudioEqPanelContentProps) {
  const isTrackMode = onTrackEqChange !== undefined;
  const isDetachedLayout = layoutMode === 'detached';
  const isCompactLayout = layoutMode === 'compact';
  const eqEnabled = enabled !== false;
  const updateItem = useTimelineStore((s) => s.updateItem);
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems);

  const audioItems = useMemo(
    () => isTrackMode ? [] : getAudioSectionItems(items ?? []),
    [isTrackMode, items],
  );
  const itemIds = useMemo(
    () => audioItems.map((item) => item.id),
    [audioItems],
  );

  const clipEqEnabled = useMemo(() => {
    if (isTrackMode || audioItems.length === 0) return true;
    return audioItems.every((item) => item.audioEqEnabled === true);
  }, [audioItems, isTrackMode]);

  const handleClipEqEnabledChange = useCallback((checked: boolean) => {
    itemIds.forEach((id) => updateItem(id, { audioEqEnabled: checked }));
  }, [itemIds, updateItem]);

  const resolvedTrackEq = useMemo(
    () => isTrackMode ? resolveAudioEqSettings(trackEq ?? {}) : null,
    [isTrackMode, trackEq],
  );
  const resolvedItemEqSettings = useMemo(
    () => audioItems.map((item) => resolveAudioEqSettings(item)),
    [audioItems],
  );

  const [livePatch, setLivePatch] = useState<AudioEqPatch | null>(null);
  const [gainBandControlRanges, setGainBandControlRanges] = useState<GainBandControlRanges>(DEFAULT_GAIN_BAND_CONTROL_RANGES);

  useEffect(() => {
    setLivePatch(null);
    setGainBandControlRanges(DEFAULT_GAIN_BAND_CONTROL_RANGES);
  }, [targetLabel]);

  const eqOutputGainDb = livePatch?.audioEqOutputGainDb ?? (resolvedTrackEq ? resolvedTrackEq.outputGainDb : getMixedValue(resolvedItemEqSettings, (item) => item.outputGainDb, 0));
  const eqBand1Enabled = livePatch?.audioEqBand1Enabled ?? (resolvedTrackEq ? resolvedTrackEq.band1Enabled : getMixedValue(resolvedItemEqSettings, (item) => item.band1Enabled, false));
  const eqBand1Type = livePatch?.audioEqBand1Type ?? (resolvedTrackEq ? resolvedTrackEq.band1Type : getMixedValue(resolvedItemEqSettings, (item) => item.band1Type, 'high-pass'));
  const eqBand1FrequencyHz = livePatch?.audioEqBand1FrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.band1FrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.band1FrequencyHz, AUDIO_EQ_LOW_CUT_FREQUENCY_HZ));
  const eqBand1GainDb = livePatch?.audioEqBand1GainDb ?? (resolvedTrackEq ? resolvedTrackEq.band1GainDb : getMixedValue(resolvedItemEqSettings, (item) => item.band1GainDb, 0));
  const eqBand1Q = livePatch?.audioEqBand1Q ?? (resolvedTrackEq ? resolvedTrackEq.band1Q : getMixedValue(resolvedItemEqSettings, (item) => item.band1Q, AUDIO_EQ_LOW_MID_Q));
  const eqBand1SlopeDbPerOct = livePatch?.audioEqBand1SlopeDbPerOct ?? (resolvedTrackEq ? resolvedTrackEq.band1SlopeDbPerOct : getMixedValue(resolvedItemEqSettings, (item) => item.band1SlopeDbPerOct, 12));
  const eqLowEnabled = livePatch?.audioEqLowEnabled ?? (resolvedTrackEq ? resolvedTrackEq.lowEnabled : getMixedValue(resolvedItemEqSettings, (item) => item.lowEnabled, true));
  const eqLowType = livePatch?.audioEqLowType ?? (resolvedTrackEq ? resolvedTrackEq.lowType : getMixedValue(resolvedItemEqSettings, (item) => item.lowType, 'low-shelf'));
  const eqLow = livePatch?.audioEqLowGainDb ?? (resolvedTrackEq ? resolvedTrackEq.lowGainDb : getMixedValue(resolvedItemEqSettings, (item) => item.lowGainDb, 0));
  const eqLowFrequencyHz = livePatch?.audioEqLowFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.lowFrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.lowFrequencyHz, AUDIO_EQ_LOW_FREQUENCY_HZ));
  const eqLowQ = livePatch?.audioEqLowQ ?? (resolvedTrackEq ? resolvedTrackEq.lowQ : getMixedValue(resolvedItemEqSettings, (item) => item.lowQ, AUDIO_EQ_LOW_MID_Q));
  const eqLowMidEnabled = livePatch?.audioEqLowMidEnabled ?? (resolvedTrackEq ? resolvedTrackEq.lowMidEnabled : getMixedValue(resolvedItemEqSettings, (item) => item.lowMidEnabled, true));
  const eqLowMidType = livePatch?.audioEqLowMidType ?? (resolvedTrackEq ? resolvedTrackEq.lowMidType : getMixedValue(resolvedItemEqSettings, (item) => item.lowMidType, 'peaking'));
  const eqLowMid = livePatch?.audioEqLowMidGainDb ?? (resolvedTrackEq ? resolvedTrackEq.lowMidGainDb : getMixedValue(resolvedItemEqSettings, (item) => item.lowMidGainDb, 0));
  const eqLowMidFrequencyHz = livePatch?.audioEqLowMidFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.lowMidFrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.lowMidFrequencyHz, AUDIO_EQ_LOW_MID_FREQUENCY_HZ));
  const eqLowMidQ = livePatch?.audioEqLowMidQ ?? (resolvedTrackEq ? resolvedTrackEq.lowMidQ : getMixedValue(resolvedItemEqSettings, (item) => item.lowMidQ, AUDIO_EQ_LOW_MID_Q));
  const eqHighMidEnabled = livePatch?.audioEqHighMidEnabled ?? (resolvedTrackEq ? resolvedTrackEq.highMidEnabled : getMixedValue(resolvedItemEqSettings, (item) => item.highMidEnabled, true));
  const eqHighMidType = livePatch?.audioEqHighMidType ?? (resolvedTrackEq ? resolvedTrackEq.highMidType : getMixedValue(resolvedItemEqSettings, (item) => item.highMidType, 'peaking'));
  const eqHighMid = livePatch?.audioEqHighMidGainDb ?? (resolvedTrackEq ? resolvedTrackEq.highMidGainDb : getMixedValue(resolvedItemEqSettings, (item) => item.highMidGainDb, 0));
  const eqHighMidFrequencyHz = livePatch?.audioEqHighMidFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.highMidFrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.highMidFrequencyHz, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ));
  const eqHighMidQ = livePatch?.audioEqHighMidQ ?? (resolvedTrackEq ? resolvedTrackEq.highMidQ : getMixedValue(resolvedItemEqSettings, (item) => item.highMidQ, AUDIO_EQ_HIGH_MID_Q));
  const eqHighEnabled = livePatch?.audioEqHighEnabled ?? (resolvedTrackEq ? resolvedTrackEq.highEnabled : getMixedValue(resolvedItemEqSettings, (item) => item.highEnabled, true));
  const eqHighType = livePatch?.audioEqHighType ?? (resolvedTrackEq ? resolvedTrackEq.highType : getMixedValue(resolvedItemEqSettings, (item) => item.highType, 'high-shelf'));
  const eqHigh = livePatch?.audioEqHighGainDb ?? (resolvedTrackEq ? resolvedTrackEq.highGainDb : getMixedValue(resolvedItemEqSettings, (item) => item.highGainDb, 0));
  const eqHighFrequencyHz = livePatch?.audioEqHighFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.highFrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.highFrequencyHz, AUDIO_EQ_HIGH_FREQUENCY_HZ));
  const eqHighQ = livePatch?.audioEqHighQ ?? (resolvedTrackEq ? resolvedTrackEq.highQ : getMixedValue(resolvedItemEqSettings, (item) => item.highQ, AUDIO_EQ_HIGH_MID_Q));
  const eqBand6Enabled = livePatch?.audioEqBand6Enabled ?? (resolvedTrackEq ? resolvedTrackEq.band6Enabled : getMixedValue(resolvedItemEqSettings, (item) => item.band6Enabled, false));
  const eqBand6Type = livePatch?.audioEqBand6Type ?? (resolvedTrackEq ? resolvedTrackEq.band6Type : getMixedValue(resolvedItemEqSettings, (item) => item.band6Type, 'low-pass'));
  const eqBand6FrequencyHz = livePatch?.audioEqBand6FrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.band6FrequencyHz : getMixedValue(resolvedItemEqSettings, (item) => item.band6FrequencyHz, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ));
  const eqBand6GainDb = livePatch?.audioEqBand6GainDb ?? (resolvedTrackEq ? resolvedTrackEq.band6GainDb : getMixedValue(resolvedItemEqSettings, (item) => item.band6GainDb, 0));
  const eqBand6Q = livePatch?.audioEqBand6Q ?? (resolvedTrackEq ? resolvedTrackEq.band6Q : getMixedValue(resolvedItemEqSettings, (item) => item.band6Q, AUDIO_EQ_HIGH_MID_Q));
  const eqBand6SlopeDbPerOct = livePatch?.audioEqBand6SlopeDbPerOct ?? (resolvedTrackEq ? resolvedTrackEq.band6SlopeDbPerOct : getMixedValue(resolvedItemEqSettings, (item) => item.band6SlopeDbPerOct, 12));

  const lowRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.low,
    eqLowFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.low,
  );
  const lowMidRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.lowMid,
    eqLowMidFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.lowMid,
  );
  const highMidRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.highMid,
    eqHighMidFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.highMid,
  );
  const highRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.high,
    eqHighFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.high,
  );

  const lowRange = getAudioEqControlRangeById(lowRangeId);
  const lowMidRange = getAudioEqControlRangeById(lowMidRangeId);
  const highMidRange = getAudioEqControlRangeById(highMidRangeId);
  const highRange = getAudioEqControlRangeById(highRangeId);

  const hasMixedEqSettings = [
    eqOutputGainDb,
    eqBand1Enabled,
    eqBand1Type,
    eqBand1FrequencyHz,
    eqBand1GainDb,
    eqBand1Q,
    eqBand1SlopeDbPerOct,
    eqLowEnabled,
    eqLowType,
    eqLow,
    eqLowFrequencyHz,
    eqLowQ,
    eqLowMidEnabled,
    eqLowMidType,
    eqLowMid,
    eqLowMidFrequencyHz,
    eqLowMidQ,
    eqHighMidEnabled,
    eqHighMidType,
    eqHighMid,
    eqHighMidFrequencyHz,
    eqHighMidQ,
    eqHighEnabled,
    eqHighType,
    eqHigh,
    eqHighFrequencyHz,
    eqHighQ,
    eqBand6Enabled,
    eqBand6Type,
    eqBand6FrequencyHz,
    eqBand6GainDb,
    eqBand6Q,
    eqBand6SlopeDbPerOct,
  ].some((value) => value === 'mixed');

  const eqControlsDisabled = hasMixedEqSettings || (isCompactLayout ? !clipEqEnabled : !eqEnabled);

  const eqCurveSettings = useMemo(
    () => resolveAudioEqSettings({
      outputGainDb: eqOutputGainDb === 'mixed' ? 0 : eqOutputGainDb,
      band1Enabled: eqBand1Enabled === 'mixed' ? false : eqBand1Enabled,
      band1Type: eqBand1Type === 'mixed' ? 'high-pass' : eqBand1Type,
      band1FrequencyHz: eqBand1FrequencyHz === 'mixed' ? AUDIO_EQ_LOW_CUT_FREQUENCY_HZ : eqBand1FrequencyHz,
      band1GainDb: eqBand1GainDb === 'mixed' ? 0 : eqBand1GainDb,
      band1Q: eqBand1Q === 'mixed' ? AUDIO_EQ_LOW_MID_Q : eqBand1Q,
      band1SlopeDbPerOct: eqBand1SlopeDbPerOct === 'mixed' ? 12 : eqBand1SlopeDbPerOct,
      lowEnabled: eqLowEnabled === 'mixed' ? true : eqLowEnabled,
      lowType: eqLowType === 'mixed' ? 'low-shelf' : eqLowType,
      lowGainDb: eqLow === 'mixed' ? 0 : eqLow,
      lowFrequencyHz: eqLowFrequencyHz === 'mixed' ? AUDIO_EQ_LOW_FREQUENCY_HZ : eqLowFrequencyHz,
      lowQ: eqLowQ === 'mixed' ? AUDIO_EQ_LOW_MID_Q : eqLowQ,
      lowMidEnabled: eqLowMidEnabled === 'mixed' ? true : eqLowMidEnabled,
      lowMidType: eqLowMidType === 'mixed' ? 'peaking' : eqLowMidType,
      lowMidGainDb: eqLowMid === 'mixed' ? 0 : eqLowMid,
      lowMidFrequencyHz: eqLowMidFrequencyHz === 'mixed' ? AUDIO_EQ_LOW_MID_FREQUENCY_HZ : eqLowMidFrequencyHz,
      lowMidQ: eqLowMidQ === 'mixed' ? AUDIO_EQ_LOW_MID_Q : eqLowMidQ,
      midGainDb: 0,
      highMidEnabled: eqHighMidEnabled === 'mixed' ? true : eqHighMidEnabled,
      highMidType: eqHighMidType === 'mixed' ? 'peaking' : eqHighMidType,
      highMidGainDb: eqHighMid === 'mixed' ? 0 : eqHighMid,
      highMidFrequencyHz: eqHighMidFrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_MID_FREQUENCY_HZ : eqHighMidFrequencyHz,
      highMidQ: eqHighMidQ === 'mixed' ? AUDIO_EQ_HIGH_MID_Q : eqHighMidQ,
      highEnabled: eqHighEnabled === 'mixed' ? true : eqHighEnabled,
      highType: eqHighType === 'mixed' ? 'high-shelf' : eqHighType,
      highGainDb: eqHigh === 'mixed' ? 0 : eqHigh,
      highFrequencyHz: eqHighFrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_FREQUENCY_HZ : eqHighFrequencyHz,
      highQ: eqHighQ === 'mixed' ? AUDIO_EQ_HIGH_MID_Q : eqHighQ,
      band6Enabled: eqBand6Enabled === 'mixed' ? false : eqBand6Enabled,
      band6Type: eqBand6Type === 'mixed' ? 'low-pass' : eqBand6Type,
      band6FrequencyHz: eqBand6FrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ : eqBand6FrequencyHz,
      band6GainDb: eqBand6GainDb === 'mixed' ? 0 : eqBand6GainDb,
      band6Q: eqBand6Q === 'mixed' ? AUDIO_EQ_HIGH_MID_Q : eqBand6Q,
      band6SlopeDbPerOct: eqBand6SlopeDbPerOct === 'mixed' ? 12 : eqBand6SlopeDbPerOct,
    }),
    [
      eqOutputGainDb,
      eqBand1Enabled,
      eqBand1Type,
      eqBand1FrequencyHz,
      eqBand1GainDb,
      eqBand1Q,
      eqBand1SlopeDbPerOct,
      eqLowEnabled,
      eqLowType,
      eqHigh,
      eqHighFrequencyHz,
      eqHighQ,
      eqHighType,
      eqHighEnabled,
      eqHighMid,
      eqHighMidFrequencyHz,
      eqHighMidQ,
      eqHighMidType,
      eqHighMidEnabled,
      eqLow,
      eqLowFrequencyHz,
      eqLowQ,
      eqLowMid,
      eqLowMidFrequencyHz,
      eqLowMidQ,
      eqLowMidType,
      eqLowMidEnabled,
      eqBand6Enabled,
      eqBand6Type,
      eqBand6FrequencyHz,
      eqBand6GainDb,
      eqBand6Q,
      eqBand6SlopeDbPerOct,
    ],
  );
  const selectedEqPresetId = useMemo(
    () => hasMixedEqSettings ? null : findAudioEqPresetId(eqCurveSettings),
    [eqCurveSettings, hasMixedEqSettings],
  );

  const eqPresetPlaceholder = hasMixedEqSettings
    ? 'Mixed'
    : (selectedEqPresetId ? getAudioEqPresetById(selectedEqPresetId)?.label ?? 'Custom' : 'Custom');

  const previewThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewRef = useRef<AudioEqPatch | null>(null);

  const clearClipEqPreview = useCallback(() => {
    if (isTrackMode || itemIds.length === 0) {
      return;
    }
    clearPreviewForItems(itemIds);
  }, [clearPreviewForItems, isTrackMode, itemIds]);

  useEffect(() => {
    if (isTrackMode) {
      return;
    }

    return () => {
      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current);
        previewThrottleRef.current = null;
      }
      pendingPreviewRef.current = null;
      clearClipEqPreview();
    };
  }, [clearClipEqPreview, isTrackMode]);

  const handleEqPatchLiveChange = useCallback((patch: AudioEqPatch) => {
    const normalizedPatch = normalizeUiEqPatch(patch);
    setLivePatch(normalizedPatch);
    if (!isTrackMode) {
      if (isCompactLayout) {
        // Throttle audio preview for clip EQ to avoid audio jitter during drag
        pendingPreviewRef.current = normalizedPatch;
        if (!previewThrottleRef.current) {
          previewThrottleRef.current = setTimeout(() => {
            previewThrottleRef.current = null;
            const pending = pendingPreviewRef.current;
            if (pending) {
              pendingPreviewRef.current = null;
              const previews: Record<string, AudioEqPatch> = {};
              itemIds.forEach((id) => { previews[id] = pending; });
              setPropertiesPreviewNew(previews);
            }
          }, 80);
        }
      } else {
        const previews: Record<string, AudioEqPatch> = {};
        itemIds.forEach((id) => { previews[id] = normalizedPatch; });
        setPropertiesPreviewNew(previews);
      }
    }
  }, [isCompactLayout, isTrackMode, itemIds, setPropertiesPreviewNew]);

  const handleEqPatchChange = useCallback((patch: AudioEqPatch) => {
    // Flush any pending throttled preview
    if (previewThrottleRef.current) {
      clearTimeout(previewThrottleRef.current);
      previewThrottleRef.current = null;
    }
    pendingPreviewRef.current = null;

    setLivePatch(null);
    if (isTrackMode && onTrackEqChange) {
      onTrackEqChange(patch);
    } else {
      const normalizedPatch = toTimelineEqPatch(patch);
      itemIds.forEach((id) => updateItem(id, normalizedPatch));
      queueMicrotask(() => clearClipEqPreview());
    }
  }, [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange, updateItem]);

  const handleEqPresetChange = useCallback((presetId: string) => {
    const preset = getAudioEqPresetById(presetId as AudioEqPresetId);
    if (!preset) return;

    if (previewThrottleRef.current) {
      clearTimeout(previewThrottleRef.current);
      previewThrottleRef.current = null;
    }
    pendingPreviewRef.current = null;
    setLivePatch(null);
    if (isTrackMode && onTrackEqChange) {
      onTrackEqChange(buildTimelineEqPatchFromResolvedSettings(preset.settings));
    } else {
      const patch = buildTimelineEqPatchFromResolvedSettings(preset.settings);
      itemIds.forEach((id) => updateItem(id, patch));
      queueMicrotask(() => clearClipEqPreview());
    }
  }, [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange, updateItem]);

  const handleEqFieldChange = useCallback(<K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => {
    handleEqPatchChange({ [field]: value } as AudioEqPatch);
  }, [handleEqPatchChange]);

  const handleGainBandControlRangeChange = useCallback((
    band: GainBandControlKey,
    rangeId: AudioEqControlRangeId,
    field: 'audioEqLowFrequencyHz' | 'audioEqLowMidFrequencyHz' | 'audioEqHighMidFrequencyHz' | 'audioEqHighFrequencyHz',
    value: number | 'mixed',
  ) => {
    setGainBandControlRanges((current) => ({ ...current, [band]: rangeId }));
    if (value === 'mixed') return;
    const nextFrequencyHz = clampFrequencyToAudioEqControlRange(value, rangeId);
    if (nextFrequencyHz !== value) {
      handleEqFieldChange(field, nextFrequencyHz);
    }
  }, [handleEqFieldChange]);

  if (!isTrackMode && audioItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
        No audio clips on {targetLabel}.
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background text-foreground">
      {!isCompactLayout ? <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        {onEnabledChange ? (
          <Switch
            checked={eqEnabled}
            onCheckedChange={onEnabledChange}
            className="h-5 w-9 shrink-0 shadow-none ring-offset-0"
            aria-label={`Turn ${targetLabel} EQ ${eqEnabled ? 'off' : 'on'}`}
          />
        ) : (
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
        )}
        <div className="text-sm font-medium text-foreground">
          Equalizer{targetLabel ? ` - ${targetLabel}` : ''}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Preset
          </div>
          <Select
            value={selectedEqPresetId ?? undefined}
            onValueChange={handleEqPresetChange}
            disabled={!eqEnabled}
          >
            <SelectTrigger className={cn('h-8 w-[220px] border-border bg-secondary/30 text-xs text-foreground', !eqEnabled && 'opacity-40')}>
              <SelectValue placeholder={eqPresetPlaceholder} />
            </SelectTrigger>
            <SelectContent container={portalContainer ?? undefined}>
              {AUDIO_EQ_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 shrink-0 px-3 text-muted-foreground hover:text-foreground', !eqEnabled && 'opacity-40')}
            onClick={() => handleEqPresetChange('flat')}
            disabled={!eqEnabled}
          >
            Reset EQ
          </Button>
        </div>
      </div> : null}

      <div className="flex-1 overflow-auto">
        {isCompactLayout ? (
          <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
            <Switch
              checked={clipEqEnabled}
              onCheckedChange={handleClipEqEnabledChange}
              className="shrink-0"
              aria-label={`Turn clip EQ ${clipEqEnabled ? 'off' : 'on'}`}
            />
            <Select
              value={selectedEqPresetId ?? undefined}
              onValueChange={handleEqPresetChange}
              disabled={!clipEqEnabled}
            >
              <SelectTrigger className={cn('h-7 flex-1 min-w-0 text-xs', !clipEqEnabled && 'opacity-40')}>
                <SelectValue placeholder={eqPresetPlaceholder} />
              </SelectTrigger>
              <SelectContent container={portalContainer ?? undefined}>
                {AUDIO_EQ_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="text-xs">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground', !clipEqEnabled && 'opacity-40')}
              onClick={() => handleEqPresetChange('flat')}
              disabled={!clipEqEnabled}
              aria-label="Reset EQ"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
        <div className={cn('relative', !isCompactLayout && 'border-b border-border')}>
          {!isTrackMode && !isCompactLayout ? (
            <div className="pointer-events-none absolute right-3 top-1 z-10 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {audioItems.length} {audioItems.length === 1 ? 'clip' : 'clips'}
            </div>
          ) : null}
          <div className="flex items-stretch gap-3 px-3 pb-3 pt-2">
            <div className="min-w-0 flex-1">
              <AudioEqCurveEditor
                settings={eqCurveSettings}
                disabled={eqControlsDisabled}
                className="text-zinc-300"
                graphClassName={cn(
                  'bg-background',
                  isDetachedLayout ? 'h-[clamp(288px,33vh,344px)]' : 'h-[220px]',
                )}
                onLiveChange={handleEqPatchLiveChange}
                onChange={handleEqPatchChange}
              />
            </div>
            {!isCompactLayout ? (
              <EqOutputGainControl
                value={eqOutputGainDb}
                disabled={eqControlsDisabled}
                compact={!isDetachedLayout}
                onLiveChange={(value) => handleEqPatchLiveChange({ audioEqOutputGainDb: value })}
                onChange={(value) => handleEqFieldChange('audioEqOutputGainDb', value)}
              />
            ) : null}
          </div>
        </div>

        {isCompactLayout ? (
          <div className={cn(eqControlsDisabled && 'pointer-events-none opacity-40')}>
          <CompactBandRows
            eqBand1Type={eqBand1Type} eqBand1Enabled={eqBand1Enabled} eqBand1FrequencyHz={eqBand1FrequencyHz} eqBand1GainDb={eqBand1GainDb} eqBand1Q={eqBand1Q}
            eqLowType={eqLowType} eqLowEnabled={eqLowEnabled} eqLowFrequencyHz={eqLowFrequencyHz} eqLow={eqLow} eqLowQ={eqLowQ} lowRange={lowRange}
            eqLowMidType={eqLowMidType} eqLowMidEnabled={eqLowMidEnabled} eqLowMidFrequencyHz={eqLowMidFrequencyHz} eqLowMid={eqLowMid} eqLowMidQ={eqLowMidQ} lowMidRange={lowMidRange}
            eqHighMidType={eqHighMidType} eqHighMidEnabled={eqHighMidEnabled} eqHighMidFrequencyHz={eqHighMidFrequencyHz} eqHighMid={eqHighMid} eqHighMidQ={eqHighMidQ} highMidRange={highMidRange}
            eqHighType={eqHighType} eqHighEnabled={eqHighEnabled} eqHighFrequencyHz={eqHighFrequencyHz} eqHigh={eqHigh} eqHighQ={eqHighQ} highRange={highRange}
            eqBand6Type={eqBand6Type} eqBand6Enabled={eqBand6Enabled} eqBand6FrequencyHz={eqBand6FrequencyHz} eqBand6GainDb={eqBand6GainDb} eqBand6Q={eqBand6Q}
            onFieldChange={handleEqFieldChange} onLiveChange={handleEqPatchLiveChange} portalContainer={portalContainer}
          />
          </div>
        ) : (
        <div className={cn(isDetachedLayout ? 'space-y-3 p-3' : 'space-y-2 p-2', eqControlsDisabled && 'pointer-events-none opacity-40')}>
          <div className={cn(isDetachedLayout && 'overflow-x-auto pb-1')}>
            <div
              className={cn(
                'grid',
                isDetachedLayout
                  ? 'min-w-[1120px] grid-cols-6 gap-2'
                  : 'grid-cols-6 gap-1',
              )}
            >
            <BandCard
              title="Band 1"
              filterType={eqBand1Type === 'mixed' ? 'high-pass' : eqBand1Type}
              filterOptions={BAND1_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqBand1Type', value as typeof BAND1_FILTER_OPTIONS[number])}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqBand1Enabled === 'mixed' ? false : eqBand1Enabled}
              onToggle={() => handleEqFieldChange('audioEqBand1Enabled', eqBand1Enabled === 'mixed' ? true : !eqBand1Enabled)}
              onReset={() => handleEqPatchChange({
                audioEqBand1Enabled: false,
                audioEqBand1Type: 'high-pass',
                audioEqBand1FrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
                audioEqBand1GainDb: 0,
                audioEqBand1Q: AUDIO_EQ_LOW_MID_Q,
                audioEqBand1SlopeDbPerOct: 12,
              })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqBand1FrequencyHz} onChange={(v) => handleEqFieldChange('audioEqBand1FrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1FrequencyHz: v })} unit="Hz" min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ} step={1} className="flex-1" />
                <RotaryKnob value={eqBand1FrequencyHz} onChange={(v) => handleEqFieldChange('audioEqBand1FrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1FrequencyHz: v })} min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}</span><span>{AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}</span></div>
              {(eqBand1Type === 'mixed' ? 'high-pass' : eqBand1Type) === 'high-pass' ? (
                <SlopeButtons value={eqBand1SlopeDbPerOct} onChange={(v) => handleEqFieldChange('audioEqBand1SlopeDbPerOct', v)} />
              ) : (
                <>
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqBand1GainDb} onChange={(v) => handleEqFieldChange('audioEqBand1GainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1GainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqBand1GainDb} onChange={(v) => handleEqFieldChange('audioEqBand1GainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1GainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqBand1Type === 'mixed' ? 'high-pass' : eqBand1Type) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqBand1Q} onChange={(v) => handleEqFieldChange('audioEqBand1Q', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1Q: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqBand1Q} onChange={(v) => handleEqFieldChange('audioEqBand1Q', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1Q: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              )}
            </BandCard>

            <BandCard
              title="Band 2"
              filterType={eqLowType === 'mixed' ? 'low-shelf' : eqLowType}
              filterOptions={INNER_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqLowType', value === 'low-pass' || value === 'high-pass' ? 'low-shelf' : value)}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqLowEnabled === 'mixed' ? false : eqLowEnabled}
              onToggle={() => handleEqFieldChange('audioEqLowEnabled', eqLowEnabled === 'mixed' ? true : !eqLowEnabled)}
              onReset={() => handleEqPatchChange({ audioEqLowEnabled: true, audioEqLowType: 'low-shelf', audioEqLowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ, audioEqLowGainDb: 0, audioEqLowQ: AUDIO_EQ_LOW_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })} unit="Hz" min={lowRange.minFrequencyHz} max={lowRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqLowFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })} min={lowRange.minFrequencyHz} max={lowRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(lowRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(lowRange.maxFrequencyHz)}</span></div>
              {(eqLowType === 'mixed' ? 'low-shelf' : eqLowType) !== 'notch' ? (
                <>
                  <RangeButtons value={lowRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('low', rangeId, 'audioEqLowFrequencyHz', eqLowFrequencyHz)} />
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqLow} onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqLow} onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqLowType === 'mixed' ? 'low-shelf' : eqLowType) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqLowQ} onChange={(v) => handleEqFieldChange('audioEqLowQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqLowQ} onChange={(v) => handleEqFieldChange('audioEqLowQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              ) : null}
            </BandCard>

            <BandCard
              title="Band 3"
              filterType={eqLowMidType === 'mixed' ? 'peaking' : eqLowMidType}
              filterOptions={INNER_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqLowMidType', value === 'low-pass' || value === 'high-pass' ? 'peaking' : value)}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqLowMidEnabled === 'mixed' ? false : eqLowMidEnabled}
              onToggle={() => handleEqFieldChange('audioEqLowMidEnabled', eqLowMidEnabled === 'mixed' ? true : !eqLowMidEnabled)}
              onReset={() => handleEqPatchChange({ audioEqLowMidEnabled: true, audioEqLowMidType: 'peaking', audioEqLowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ, audioEqLowMidGainDb: 0, audioEqLowMidQ: AUDIO_EQ_LOW_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })} unit="Hz" min={lowMidRange.minFrequencyHz} max={lowMidRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqLowMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })} min={lowMidRange.minFrequencyHz} max={lowMidRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(lowMidRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(lowMidRange.maxFrequencyHz)}</span></div>
              {(eqLowMidType === 'mixed' ? 'peaking' : eqLowMidType) !== 'notch' ? (
                <>
                  <RangeButtons value={lowMidRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('lowMid', rangeId, 'audioEqLowMidFrequencyHz', eqLowMidFrequencyHz)} />
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqLowMid} onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqLowMid} onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqLowMidType === 'mixed' ? 'peaking' : eqLowMidType) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqLowMidQ} onChange={(v) => handleEqFieldChange('audioEqLowMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqLowMidQ} onChange={(v) => handleEqFieldChange('audioEqLowMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              ) : null}
            </BandCard>

            <BandCard
              title="Band 4"
              filterType={eqHighMidType === 'mixed' ? 'peaking' : eqHighMidType}
              filterOptions={INNER_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqHighMidType', value === 'low-pass' || value === 'high-pass' ? 'peaking' : value)}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqHighMidEnabled === 'mixed' ? false : eqHighMidEnabled}
              onToggle={() => handleEqFieldChange('audioEqHighMidEnabled', eqHighMidEnabled === 'mixed' ? true : !eqHighMidEnabled)}
              onReset={() => handleEqPatchChange({ audioEqHighMidEnabled: true, audioEqHighMidType: 'peaking', audioEqHighMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ, audioEqHighMidGainDb: 0, audioEqHighMidQ: AUDIO_EQ_HIGH_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })} unit="Hz" min={highMidRange.minFrequencyHz} max={highMidRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqHighMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })} min={highMidRange.minFrequencyHz} max={highMidRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(highMidRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(highMidRange.maxFrequencyHz)}</span></div>
              {(eqHighMidType === 'mixed' ? 'peaking' : eqHighMidType) !== 'notch' ? (
                <>
                  <RangeButtons value={highMidRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('highMid', rangeId, 'audioEqHighMidFrequencyHz', eqHighMidFrequencyHz)} />
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqHighMid} onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqHighMid} onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqHighMidType === 'mixed' ? 'peaking' : eqHighMidType) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqHighMidQ} onChange={(v) => handleEqFieldChange('audioEqHighMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqHighMidQ} onChange={(v) => handleEqFieldChange('audioEqHighMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              ) : null}
            </BandCard>

            <BandCard
              title="Band 5"
              filterType={eqHighType === 'mixed' ? 'high-shelf' : eqHighType}
              filterOptions={INNER_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqHighType', value === 'low-pass' || value === 'high-pass' ? 'high-shelf' : value)}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqHighEnabled === 'mixed' ? false : eqHighEnabled}
              onToggle={() => handleEqFieldChange('audioEqHighEnabled', eqHighEnabled === 'mixed' ? true : !eqHighEnabled)}
              onReset={() => handleEqPatchChange({ audioEqHighEnabled: true, audioEqHighType: 'high-shelf', audioEqHighFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ, audioEqHighGainDb: 0, audioEqHighQ: AUDIO_EQ_HIGH_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })} unit="Hz" min={highRange.minFrequencyHz} max={highRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqHighFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })} min={highRange.minFrequencyHz} max={highRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(highRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(highRange.maxFrequencyHz)}</span></div>
              {(eqHighType === 'mixed' ? 'high-shelf' : eqHighType) !== 'notch' ? (
                <>
                  <RangeButtons value={highRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('high', rangeId, 'audioEqHighFrequencyHz', eqHighFrequencyHz)} />
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqHigh} onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqHigh} onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqHighType === 'mixed' ? 'high-shelf' : eqHighType) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqHighQ} onChange={(v) => handleEqFieldChange('audioEqHighQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqHighQ} onChange={(v) => handleEqFieldChange('audioEqHighQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighQ: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              ) : null}
            </BandCard>

            <BandCard
              title="Band 6"
              filterType={eqBand6Type === 'mixed' ? 'low-pass' : eqBand6Type}
              filterOptions={BAND6_FILTER_OPTIONS}
              onFilterTypeChange={(value) => handleEqFieldChange('audioEqBand6Type', value === 'high-pass' || value === 'notch' ? 'low-pass' : value)}
              portalContainer={portalContainer}
              compact={!isDetachedLayout}
              active={eqBand6Enabled === 'mixed' ? false : eqBand6Enabled}
              onToggle={() => handleEqFieldChange('audioEqBand6Enabled', eqBand6Enabled === 'mixed' ? true : !eqBand6Enabled)}
              onReset={() => handleEqPatchChange({
                audioEqBand6Enabled: false,
                audioEqBand6Type: 'low-pass',
                audioEqBand6FrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
                audioEqBand6GainDb: 0,
                audioEqBand6Q: AUDIO_EQ_HIGH_MID_Q,
                audioEqBand6SlopeDbPerOct: 12,
              })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqBand6FrequencyHz} onChange={(v) => handleEqFieldChange('audioEqBand6FrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6FrequencyHz: v })} unit="Hz" min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ} step={1} className="flex-1" />
                <RotaryKnob value={eqBand6FrequencyHz} onChange={(v) => handleEqFieldChange('audioEqBand6FrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6FrequencyHz: v })} min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>1.4K</span><span>22.0K</span></div>
              {(eqBand6Type === 'mixed' ? 'low-pass' : eqBand6Type) === 'low-pass' ? (
                <SlopeButtons value={eqBand6SlopeDbPerOct} onChange={(v) => handleEqFieldChange('audioEqBand6SlopeDbPerOct', v)} />
              ) : (
                <>
                  <div className="text-[10px] text-zinc-500">Gain</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={eqBand6GainDb} onChange={(v) => handleEqFieldChange('audioEqBand6GainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6GainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                    <RotaryKnob value={eqBand6GainDb} onChange={(v) => handleEqFieldChange('audioEqBand6GainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6GainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_GAIN_DB_MIN} dB</span><span>{AUDIO_EQ_GAIN_DB_MAX > 0 ? `+${AUDIO_EQ_GAIN_DB_MAX}` : AUDIO_EQ_GAIN_DB_MAX}</span></div>
                  {(eqBand6Type === 'mixed' ? 'low-pass' : eqBand6Type) === 'peaking' ? (
                    <>
                      <div className="text-[10px] text-zinc-500">Q Factor</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput value={eqBand6Q} onChange={(v) => handleEqFieldChange('audioEqBand6Q', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6Q: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} className="flex-1" />
                        <RotaryKnob value={eqBand6Q} onChange={(v) => handleEqFieldChange('audioEqBand6Q', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6Q: v })} min={AUDIO_EQ_Q_MIN} max={AUDIO_EQ_Q_MAX} step={0.05} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span><span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span></div>
                    </>
                  ) : null}
                </>
              )}
            </BandCard>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
