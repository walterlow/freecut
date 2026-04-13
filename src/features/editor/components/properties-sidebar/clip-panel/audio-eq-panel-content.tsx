import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
}

type FilterType = 'low-cut' | 'low-shelf' | 'bell' | 'high-shelf' | 'high-cut';

const FILTER_TYPE_PATHS: Record<FilterType, string> = {
  'low-cut': 'M2 10 C5 10 7 3 10 3 L18 3',
  'low-shelf': 'M2 9 L5 9 C7 9 8 3 10 3 L18 3',
  'bell': 'M2 8 C5 8 7 2 10 2 C13 2 15 8 18 8',
  'high-shelf': 'M2 3 L8 3 C10 3 11 9 13 9 L18 9',
  'high-cut': 'M2 3 L8 3 C11 3 13 10 16 10 L18 10',
};

const FILTER_TYPE_LABELS: Record<FilterType, string> = {
  'low-cut': 'Low Cut',
  'low-shelf': 'Low Shelf',
  'bell': 'Bell',
  'high-shelf': 'High Shelf',
  'high-cut': 'High Cut',
};

function FilterTypeIcon({ type }: { type: FilterType }) {
  return (
    <div
      className="flex h-6 items-center rounded-[4px] border border-[#2e2e31] bg-[#151517] px-1.5"
      title={FILTER_TYPE_LABELS[type]}
    >
      <svg viewBox="0 0 20 12" className="h-3 w-5 text-zinc-400">
        <path
          d={FILTER_TYPE_PATHS[type]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
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

interface BandCardProps {
  title: string;
  filterType: FilterType;
  active?: boolean;
  onToggle?: () => void;
  onReset: () => void;
  children: ReactNode;
}

function BandCard({
  title,
  filterType,
  active = true,
  onToggle,
  onReset,
  children,
}: BandCardProps) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-[6px] border border-[#2e2e31] bg-[#212124] transition-opacity',
        !active && onToggle && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-[#28282b] px-2 py-2">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {title}
          </button>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground">
            {title}
          </span>
        )}
        <FilterTypeIcon type={filterType} />
        <button
          type="button"
          className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
          onClick={onReset}
          aria-label={`Reset ${title}`}
          title={`Reset ${title}`}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {children}
      </div>
    </section>
  );
}

export function AudioEqPanelContent({
  items,
  targetLabel,
  trackEq,
  enabled = true,
  onTrackEqChange,
  onEnabledChange,
}: AudioEqPanelContentProps) {
  const isTrackMode = onTrackEqChange !== undefined;
  const eqEnabled = enabled !== false;
  const updateItem = useTimelineStore((s) => s.updateItem);
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  const audioItems = useMemo(
    () => isTrackMode ? [] : getAudioSectionItems(items ?? []),
    [isTrackMode, items],
  );
  const itemIds = useMemo(
    () => audioItems.map((item) => item.id),
    [audioItems],
  );

  const resolvedTrackEq = useMemo(
    () => isTrackMode ? resolveAudioEqSettings(trackEq ?? {}) : null,
    [isTrackMode, trackEq],
  );

  const [livePatch, setLivePatch] = useState<AudioEqPatch | null>(null);
  const [gainBandControlRanges, setGainBandControlRanges] = useState<GainBandControlRanges>(DEFAULT_GAIN_BAND_CONTROL_RANGES);

  useEffect(() => {
    setGainBandControlRanges(DEFAULT_GAIN_BAND_CONTROL_RANGES);
  }, [targetLabel]);

  const eqLowCutEnabled = livePatch?.audioEqLowCutEnabled ?? (resolvedTrackEq ? resolvedTrackEq.lowCutEnabled : getMixedValue(audioItems, (item) => item.audioEqLowCutEnabled ?? false, false));
  const eqLowCutFrequencyHz = livePatch?.audioEqLowCutFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.lowCutFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqLowCutFrequencyHz ?? AUDIO_EQ_LOW_CUT_FREQUENCY_HZ, AUDIO_EQ_LOW_CUT_FREQUENCY_HZ));
  const eqLowCutSlopeDbPerOct = livePatch?.audioEqLowCutSlopeDbPerOct ?? (resolvedTrackEq ? resolvedTrackEq.lowCutSlopeDbPerOct : getMixedValue(audioItems, (item) => item.audioEqLowCutSlopeDbPerOct ?? 12, 12));
  const eqLow = livePatch?.audioEqLowGainDb ?? (resolvedTrackEq ? resolvedTrackEq.lowGainDb : getMixedValue(audioItems, (item) => item.audioEqLowGainDb ?? 0, 0));
  const eqLowFrequencyHz = livePatch?.audioEqLowFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.lowFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqLowFrequencyHz ?? AUDIO_EQ_LOW_FREQUENCY_HZ, AUDIO_EQ_LOW_FREQUENCY_HZ));
  const eqLowMid = livePatch?.audioEqLowMidGainDb ?? (resolvedTrackEq ? resolvedTrackEq.lowMidGainDb : getMixedValue(audioItems, (item) => item.audioEqLowMidGainDb ?? 0, 0));
  const eqLowMidFrequencyHz = livePatch?.audioEqLowMidFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.lowMidFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqLowMidFrequencyHz ?? AUDIO_EQ_LOW_MID_FREQUENCY_HZ, AUDIO_EQ_LOW_MID_FREQUENCY_HZ));
  const eqLowMidQ = livePatch?.audioEqLowMidQ ?? (resolvedTrackEq ? resolvedTrackEq.lowMidQ : getMixedValue(audioItems, (item) => item.audioEqLowMidQ ?? AUDIO_EQ_LOW_MID_Q, AUDIO_EQ_LOW_MID_Q));
  const eqMid = livePatch?.audioEqMidGainDb ?? (resolvedTrackEq ? resolvedTrackEq.midGainDb : getMixedValue(audioItems, (item) => item.audioEqMidGainDb ?? 0, 0));
  const eqHighMid = livePatch?.audioEqHighMidGainDb ?? (resolvedTrackEq ? resolvedTrackEq.highMidGainDb : getMixedValue(audioItems, (item) => item.audioEqHighMidGainDb ?? 0, 0));
  const eqHighMidFrequencyHz = livePatch?.audioEqHighMidFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.highMidFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqHighMidFrequencyHz ?? AUDIO_EQ_HIGH_MID_FREQUENCY_HZ, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ));
  const eqHighMidQ = livePatch?.audioEqHighMidQ ?? (resolvedTrackEq ? resolvedTrackEq.highMidQ : getMixedValue(audioItems, (item) => item.audioEqHighMidQ ?? AUDIO_EQ_HIGH_MID_Q, AUDIO_EQ_HIGH_MID_Q));
  const eqHigh = livePatch?.audioEqHighGainDb ?? (resolvedTrackEq ? resolvedTrackEq.highGainDb : getMixedValue(audioItems, (item) => item.audioEqHighGainDb ?? 0, 0));
  const eqHighFrequencyHz = livePatch?.audioEqHighFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.highFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqHighFrequencyHz ?? AUDIO_EQ_HIGH_FREQUENCY_HZ, AUDIO_EQ_HIGH_FREQUENCY_HZ));
  const eqHighCutEnabled = livePatch?.audioEqHighCutEnabled ?? (resolvedTrackEq ? resolvedTrackEq.highCutEnabled : getMixedValue(audioItems, (item) => item.audioEqHighCutEnabled ?? false, false));
  const eqHighCutFrequencyHz = livePatch?.audioEqHighCutFrequencyHz ?? (resolvedTrackEq ? resolvedTrackEq.highCutFrequencyHz : getMixedValue(audioItems, (item) => item.audioEqHighCutFrequencyHz ?? AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ));
  const eqHighCutSlopeDbPerOct = livePatch?.audioEqHighCutSlopeDbPerOct ?? (resolvedTrackEq ? resolvedTrackEq.highCutSlopeDbPerOct : getMixedValue(audioItems, (item) => item.audioEqHighCutSlopeDbPerOct ?? 12, 12));

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
    eqLowCutEnabled,
    eqLowCutFrequencyHz,
    eqLowCutSlopeDbPerOct,
    eqLow,
    eqLowFrequencyHz,
    eqLowMid,
    eqLowMidFrequencyHz,
    eqLowMidQ,
    eqMid,
    eqHighMid,
    eqHighMidFrequencyHz,
    eqHighMidQ,
    eqHigh,
    eqHighFrequencyHz,
    eqHighCutEnabled,
    eqHighCutFrequencyHz,
    eqHighCutSlopeDbPerOct,
  ].some((value) => value === 'mixed');

  const selectedEqPresetId = useMemo(() => {
    if (hasMixedEqSettings) return null;
    return findAudioEqPresetId({
      lowCutEnabled: eqLowCutEnabled as boolean,
      lowCutFrequencyHz: eqLowCutFrequencyHz as number,
      lowCutSlopeDbPerOct: eqLowCutSlopeDbPerOct as 6 | 12 | 18 | 24,
      lowGainDb: eqLow as number,
      lowFrequencyHz: eqLowFrequencyHz as number,
      lowMidGainDb: eqLowMid as number,
      lowMidFrequencyHz: eqLowMidFrequencyHz as number,
      lowMidQ: eqLowMidQ as number,
      midGainDb: eqMid as number,
      highMidGainDb: eqHighMid as number,
      highMidFrequencyHz: eqHighMidFrequencyHz as number,
      highMidQ: eqHighMidQ as number,
      highGainDb: eqHigh as number,
      highFrequencyHz: eqHighFrequencyHz as number,
      highCutEnabled: eqHighCutEnabled as boolean,
      highCutFrequencyHz: eqHighCutFrequencyHz as number,
      highCutSlopeDbPerOct: eqHighCutSlopeDbPerOct as 6 | 12 | 18 | 24,
    });
  }, [
    eqHigh,
    eqHighCutEnabled,
    eqHighCutFrequencyHz,
    eqHighCutSlopeDbPerOct,
    eqHighFrequencyHz,
    eqHighMid,
    eqHighMidFrequencyHz,
    eqHighMidQ,
    eqLow,
    eqLowCutEnabled,
    eqLowCutFrequencyHz,
    eqLowCutSlopeDbPerOct,
    eqLowFrequencyHz,
    eqLowMid,
    eqLowMidFrequencyHz,
    eqLowMidQ,
    eqMid,
    hasMixedEqSettings,
  ]);

  const eqPresetPlaceholder = hasMixedEqSettings
    ? 'Mixed'
    : (selectedEqPresetId ? getAudioEqPresetById(selectedEqPresetId)?.label ?? 'Custom' : 'Custom');

  const eqCurveSettings = useMemo(
    () => resolveAudioEqSettings({
      lowCutEnabled: eqLowCutEnabled === 'mixed' ? false : eqLowCutEnabled,
      lowCutFrequencyHz: eqLowCutFrequencyHz === 'mixed' ? AUDIO_EQ_LOW_CUT_FREQUENCY_HZ : eqLowCutFrequencyHz,
      lowCutSlopeDbPerOct: eqLowCutSlopeDbPerOct === 'mixed' ? 12 : eqLowCutSlopeDbPerOct,
      lowGainDb: eqLow === 'mixed' ? 0 : eqLow,
      lowFrequencyHz: eqLowFrequencyHz === 'mixed' ? AUDIO_EQ_LOW_FREQUENCY_HZ : eqLowFrequencyHz,
      lowMidGainDb: eqLowMid === 'mixed' ? 0 : eqLowMid,
      lowMidFrequencyHz: eqLowMidFrequencyHz === 'mixed' ? AUDIO_EQ_LOW_MID_FREQUENCY_HZ : eqLowMidFrequencyHz,
      lowMidQ: eqLowMidQ === 'mixed' ? AUDIO_EQ_LOW_MID_Q : eqLowMidQ,
      midGainDb: eqMid === 'mixed' ? 0 : eqMid,
      highMidGainDb: eqHighMid === 'mixed' ? 0 : eqHighMid,
      highMidFrequencyHz: eqHighMidFrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_MID_FREQUENCY_HZ : eqHighMidFrequencyHz,
      highMidQ: eqHighMidQ === 'mixed' ? AUDIO_EQ_HIGH_MID_Q : eqHighMidQ,
      highGainDb: eqHigh === 'mixed' ? 0 : eqHigh,
      highFrequencyHz: eqHighFrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_FREQUENCY_HZ : eqHighFrequencyHz,
      highCutEnabled: eqHighCutEnabled === 'mixed' ? false : eqHighCutEnabled,
      highCutFrequencyHz: eqHighCutFrequencyHz === 'mixed' ? AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ : eqHighCutFrequencyHz,
      highCutSlopeDbPerOct: eqHighCutSlopeDbPerOct === 'mixed' ? 12 : eqHighCutSlopeDbPerOct,
    }),
    [
      eqHigh,
      eqHighCutEnabled,
      eqHighCutFrequencyHz,
      eqHighCutSlopeDbPerOct,
      eqHighFrequencyHz,
      eqHighMid,
      eqHighMidFrequencyHz,
      eqHighMidQ,
      eqLow,
      eqLowCutEnabled,
      eqLowCutFrequencyHz,
      eqLowCutSlopeDbPerOct,
      eqLowFrequencyHz,
      eqLowMid,
      eqLowMidFrequencyHz,
      eqLowMidQ,
      eqMid,
    ],
  );

  const handleEqPatchLiveChange = useCallback((patch: AudioEqPatch) => {
    const normalizedPatch = normalizeUiEqPatch(patch);
    setLivePatch(normalizedPatch);
    if (!isTrackMode) {
      const previews: Record<string, AudioEqPatch> = {};
      itemIds.forEach((id) => {
        previews[id] = normalizedPatch;
      });
      setPropertiesPreviewNew(previews);
    }
  }, [isTrackMode, itemIds, setPropertiesPreviewNew]);

  const handleEqPatchChange = useCallback((patch: AudioEqPatch) => {
    setLivePatch(null);
    if (isTrackMode && onTrackEqChange) {
      onTrackEqChange(patch);
    } else {
      const normalizedPatch = toTimelineEqPatch(patch);
      itemIds.forEach((id) => updateItem(id, normalizedPatch));
      queueMicrotask(() => clearPreview());
    }
  }, [clearPreview, isTrackMode, itemIds, onTrackEqChange, updateItem]);

  const handleEqPresetChange = useCallback((presetId: string) => {
    const preset = getAudioEqPresetById(presetId as AudioEqPresetId);
    if (!preset) return;

    setLivePatch(null);
    if (isTrackMode && onTrackEqChange) {
      onTrackEqChange(buildTimelineEqPatchFromResolvedSettings(preset.settings));
    } else {
      const patch = buildTimelineEqPatchFromResolvedSettings(preset.settings);
      itemIds.forEach((id) => updateItem(id, patch));
      queueMicrotask(() => clearPreview());
    }
  }, [clearPreview, isTrackMode, itemIds, onTrackEqChange, updateItem]);

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
    <div className="flex h-full flex-col bg-[#18181b] text-zinc-100">
      <div className="flex items-center gap-3 border-b border-[#2a2a2d] px-3 py-2">
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
        <div className="text-sm font-medium text-zinc-100">
          Equalizer
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Preset
          </div>
          <Select
            value={selectedEqPresetId ?? undefined}
            onValueChange={handleEqPresetChange}
          >
            <SelectTrigger className="h-8 w-[220px] border-[#2e2e31] bg-[#1e1e21] text-xs text-zinc-100">
              <SelectValue placeholder={eqPresetPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_EQ_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="relative border-b border-[#2e2e31]">
          <div className="pointer-events-none absolute left-3 right-3 top-2 z-10 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            <span>{targetLabel}</span>
            {!isTrackMode && <span>{audioItems.length} {audioItems.length === 1 ? 'clip' : 'clips'}</span>}
            {isTrackMode && <span>Track EQ</span>}
          </div>
          <AudioEqCurveEditor
            settings={eqCurveSettings}
            disabled={hasMixedEqSettings}
            className="text-zinc-300"
            graphClassName="h-[200px] bg-[#141416]"
            onLiveChange={handleEqPatchLiveChange}
            onChange={handleEqPatchChange}
          />
        </div>

        <div className="space-y-3 p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <BandCard
              title="Band 1"
              filterType="low-cut"
              active={eqLowCutEnabled === 'mixed' ? false : eqLowCutEnabled}
              onToggle={() => handleEqFieldChange('audioEqLowCutEnabled', eqLowCutEnabled === 'mixed' ? true : !eqLowCutEnabled)}
              onReset={() => handleEqPatchChange({
                audioEqLowCutEnabled: false,
                audioEqLowCutFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
                audioEqLowCutSlopeDbPerOct: 12,
              })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowCutFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowCutFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowCutFrequencyHz: v })} unit="Hz" min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ} step={1} className="flex-1" />
                <RotaryKnob value={eqLowCutFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowCutFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowCutFrequencyHz: v })} min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>30</span><span>399</span></div>
              <SlopeButtons value={eqLowCutSlopeDbPerOct} onChange={(v) => handleEqFieldChange('audioEqLowCutSlopeDbPerOct', v)} />
            </BandCard>

            <BandCard
              title="Band 2"
              filterType="low-shelf"
              onReset={() => handleEqPatchChange({ audioEqLowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ, audioEqLowGainDb: 0 })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })} unit="Hz" min={lowRange.minFrequencyHz} max={lowRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqLowFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })} min={lowRange.minFrequencyHz} max={lowRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(lowRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(lowRange.maxFrequencyHz)}</span></div>
              <RangeButtons value={lowRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('low', rangeId, 'audioEqLowFrequencyHz', eqLowFrequencyHz)} />
              <div className="text-[10px] text-zinc-500">Gain</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLow} onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                <RotaryKnob value={eqLow} onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>-18 dB</span><span>+18</span></div>
            </BandCard>

            <BandCard
              title="Band 3"
              filterType="bell"
              onReset={() => handleEqPatchChange({ audioEqLowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ, audioEqLowMidGainDb: 0, audioEqLowMidQ: AUDIO_EQ_LOW_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })} unit="Hz" min={lowMidRange.minFrequencyHz} max={lowMidRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqLowMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })} min={lowMidRange.minFrequencyHz} max={lowMidRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(lowMidRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(lowMidRange.maxFrequencyHz)}</span></div>
              <RangeButtons value={lowMidRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('lowMid', rangeId, 'audioEqLowMidFrequencyHz', eqLowMidFrequencyHz)} />
              <div className="text-[10px] text-zinc-500">Gain</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowMid} onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                <RotaryKnob value={eqLowMid} onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>-18 dB</span><span>+18</span></div>
              <div className="text-[10px] text-zinc-500">Q Factor</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqLowMidQ} onChange={(v) => handleEqFieldChange('audioEqLowMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidQ: v })} min={0.3} max={8} step={0.05} className="flex-1" />
                <RotaryKnob value={eqLowMidQ} onChange={(v) => handleEqFieldChange('audioEqLowMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidQ: v })} min={0.3} max={8} step={0.05} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>0.3</span><span>8.0</span></div>
            </BandCard>

            <BandCard
              title="Band 4"
              filterType="bell"
              onReset={() => handleEqPatchChange({ audioEqHighMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ, audioEqHighMidGainDb: 0, audioEqHighMidQ: AUDIO_EQ_HIGH_MID_Q })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })} unit="Hz" min={highMidRange.minFrequencyHz} max={highMidRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqHighMidFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })} min={highMidRange.minFrequencyHz} max={highMidRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(highMidRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(highMidRange.maxFrequencyHz)}</span></div>
              <RangeButtons value={highMidRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('highMid', rangeId, 'audioEqHighMidFrequencyHz', eqHighMidFrequencyHz)} />
              <div className="text-[10px] text-zinc-500">Gain</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighMid} onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                <RotaryKnob value={eqHighMid} onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>-18 dB</span><span>+18</span></div>
              <div className="text-[10px] text-zinc-500">Q Factor</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighMidQ} onChange={(v) => handleEqFieldChange('audioEqHighMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidQ: v })} min={0.3} max={8} step={0.05} className="flex-1" />
                <RotaryKnob value={eqHighMidQ} onChange={(v) => handleEqFieldChange('audioEqHighMidQ', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidQ: v })} min={0.3} max={8} step={0.05} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>0.3</span><span>8.0</span></div>
            </BandCard>

            <BandCard
              title="Band 5"
              filterType="high-shelf"
              onReset={() => handleEqPatchChange({ audioEqHighFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ, audioEqHighGainDb: 0 })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })} unit="Hz" min={highRange.minFrequencyHz} max={highRange.maxFrequencyHz} step={1} className="flex-1" />
                <RotaryKnob value={eqHighFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })} min={highRange.minFrequencyHz} max={highRange.maxFrequencyHz} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>{formatFrequencyRangeLabel(highRange.minFrequencyHz)}</span><span>{formatFrequencyRangeLabel(highRange.maxFrequencyHz)}</span></div>
              <RangeButtons value={highRangeId} onChange={(rangeId) => handleGainBandControlRangeChange('high', rangeId, 'audioEqHighFrequencyHz', eqHighFrequencyHz)} />
              <div className="text-[10px] text-zinc-500">Gain</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHigh} onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })} unit="dB" min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} className="flex-1" />
                <RotaryKnob value={eqHigh} onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })} min={AUDIO_EQ_GAIN_DB_MIN} max={AUDIO_EQ_GAIN_DB_MAX} step={0.1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>-18 dB</span><span>+18</span></div>
            </BandCard>

            <BandCard
              title="Band 6"
              filterType="high-cut"
              active={eqHighCutEnabled === 'mixed' ? false : eqHighCutEnabled}
              onToggle={() => handleEqFieldChange('audioEqHighCutEnabled', eqHighCutEnabled === 'mixed' ? true : !eqHighCutEnabled)}
              onReset={() => handleEqPatchChange({ audioEqHighCutEnabled: false, audioEqHighCutFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ, audioEqHighCutSlopeDbPerOct: 12 })}
            >
              <div className="text-[10px] text-zinc-500">Frequency</div>
              <div className="flex items-center gap-1.5">
                <NumberInput value={eqHighCutFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighCutFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighCutFrequencyHz: v })} unit="Hz" min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ} step={1} className="flex-1" />
                <RotaryKnob value={eqHighCutFrequencyHz} onChange={(v) => handleEqFieldChange('audioEqHighCutFrequencyHz', v)} onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighCutFrequencyHz: v })} min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ} max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ} step={1} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600"><span>1.4K</span><span>22.0K</span></div>
              <SlopeButtons value={eqHighCutSlopeDbPerOct} onChange={(v) => handleEqFieldChange('audioEqHighCutSlopeDbPerOct', v)} />
            </BandCard>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-400 hover:text-zinc-100"
              onClick={() => handleEqPresetChange('flat')}
            >
              Reset EQ
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
