import { useCallback, useMemo } from 'react';
import { RotateCcw, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { TimelineItem } from '@/types/timeline';
import { useKeyframesStore, useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview';
import {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
  getPropertyKeyframes,
  interpolatePropertyValue,
  KeyframeToggle,
} from '@/features/editor/deps/keyframes';
import {
  NumberInput,
  PropertyRow,
  PropertySection,
  SliderInput,
} from '../components';
import { getMixedValue } from '../utils';
import { getAudioSectionItems } from './audio-section-utils';
import { AudioEqCurveEditor, type AudioEqPatch } from './audio-eq-curve-editor';
import { buildTimelineEqPatchFromResolvedSettings, normalizeUiEqPatch, toTimelineEqPatch } from './audio-eq-ui';
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  AUDIO_EQ_PRESETS,
  type AudioEqPresetId,
  findAudioEqPresetId,
  getAudioEqPresetById,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq';
import {
  AUDIO_PITCH_CENTS_MAX,
  AUDIO_PITCH_CENTS_MIN,
  AUDIO_PITCH_SEMITONES_MAX,
  AUDIO_PITCH_SEMITONES_MIN,
} from '@/shared/utils/audio-pitch';

interface AudioSectionProps {
  items: TimelineItem[];
}

const AUDIO_GAIN_DB_MIN = -60;
const AUDIO_GAIN_DB_MAX = 12;
const AUDIO_EQ_SLOPE_OPTIONS = [6, 12, 18, 24] as const;

/**
 * Audio section - volume, EQ, and audio fades.
 * Shown for video and audio clips.
 */
export function AudioSection({ items }: AudioSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems);
  const currentFrame = useThrottledFrame();
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations);

  const audioItems = useMemo(
    () => getAudioSectionItems(items),
    [items],
  );

  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems]);
  const audioItemsById = useMemo(() => new Map(audioItems.map((item) => [item.id, item])), [audioItems]);
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback(
        (s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null),
        [itemIds],
      ),
    ),
  );
  const keyframesByItemId = useMemo(() => {
    const map = new Map<string, (typeof itemKeyframes)[number]>();
    for (const [index, itemId] of itemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null);
    }
    return map;
  }, [itemIds, itemKeyframes]);

  const volume = useMemo(() => {
    if (audioItems.length === 0) return 0 as number | 'mixed';

    const values = audioItems.map((item) => {
      const staticVolume = item.volume ?? 0;
      const itemKeyframes = keyframesByItemId.get(item.id) ?? undefined;
      if (itemKeyframes) {
        const volumeKfs = getPropertyKeyframes(itemKeyframes, 'volume');
        if (volumeKfs.length > 0) {
          const relativeFrame = currentFrame - item.from;
          return interpolatePropertyValue(volumeKfs, relativeFrame, staticVolume);
        }
      }
      return staticVolume;
    });

    const first = values[0]!;
    return values.every((v) => Math.abs(v - first) < 0.01)
      ? Math.round(first * 10) / 10
      : ('mixed' as const);
  }, [audioItems, currentFrame, keyframesByItemId]);

  const fadeIn = getMixedValue(audioItems, (item) => item.audioFadeIn, 0);
  const fadeOut = getMixedValue(audioItems, (item) => item.audioFadeOut, 0);
  const pitchSemitones = getMixedValue(audioItems, (item) => item.audioPitchSemitones ?? 0, 0);
  const pitchCents = getMixedValue(audioItems, (item) => item.audioPitchCents ?? 0, 0);

  const eqLowCutEnabled = getMixedValue(audioItems, (item) => item.audioEqLowCutEnabled ?? false, false);
  const eqLowCutFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqLowCutFrequencyHz ?? AUDIO_EQ_LOW_CUT_FREQUENCY_HZ, AUDIO_EQ_LOW_CUT_FREQUENCY_HZ);
  const eqLowCutSlopeDbPerOct = getMixedValue(audioItems, (item) => item.audioEqLowCutSlopeDbPerOct ?? 12, 12);
  const eqLow = getMixedValue(audioItems, (item) => item.audioEqLowGainDb ?? 0, 0);
  const eqLowFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqLowFrequencyHz ?? AUDIO_EQ_LOW_FREQUENCY_HZ, AUDIO_EQ_LOW_FREQUENCY_HZ);
  const eqLowMid = getMixedValue(audioItems, (item) => item.audioEqLowMidGainDb ?? 0, 0);
  const eqLowMidFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqLowMidFrequencyHz ?? AUDIO_EQ_LOW_MID_FREQUENCY_HZ, AUDIO_EQ_LOW_MID_FREQUENCY_HZ);
  const eqLowMidQ = getMixedValue(audioItems, (item) => item.audioEqLowMidQ ?? AUDIO_EQ_LOW_MID_Q, AUDIO_EQ_LOW_MID_Q);
  const eqHighMid = getMixedValue(audioItems, (item) => item.audioEqHighMidGainDb ?? 0, 0);
  const eqHighMidFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqHighMidFrequencyHz ?? AUDIO_EQ_HIGH_MID_FREQUENCY_HZ, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ);
  const eqHighMidQ = getMixedValue(audioItems, (item) => item.audioEqHighMidQ ?? AUDIO_EQ_HIGH_MID_Q, AUDIO_EQ_HIGH_MID_Q);
  const eqHigh = getMixedValue(audioItems, (item) => item.audioEqHighGainDb ?? 0, 0);
  const eqHighFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqHighFrequencyHz ?? AUDIO_EQ_HIGH_FREQUENCY_HZ, AUDIO_EQ_HIGH_FREQUENCY_HZ);
  const eqHighCutEnabled = getMixedValue(audioItems, (item) => item.audioEqHighCutEnabled ?? false, false);
  const eqHighCutFrequencyHz = getMixedValue(audioItems, (item) => item.audioEqHighCutFrequencyHz ?? AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ);
  const eqHighCutSlopeDbPerOct = getMixedValue(audioItems, (item) => item.audioEqHighCutSlopeDbPerOct ?? 12, 12);

  const hasMixedEqSettings = [
    eqLowCutEnabled,
    eqLowCutFrequencyHz,
    eqLowCutSlopeDbPerOct,
    eqLow,
    eqLowFrequencyHz,
    eqLowMid,
    eqLowMidFrequencyHz,
    eqLowMidQ,
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
      midGainDb: 0,
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
      midGainDb: 0,
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
    ],
  );

  const autoKeyframeVolume = useCallback(
    (itemId: string, value: number): AutoKeyframeOperation | null => {
      const item = audioItemsById.get(itemId);
      if (!item) return null;

      const itemKeyframes = keyframesByItemId.get(itemId) ?? undefined;
      return getAutoKeyframeOperation(item, itemKeyframes, 'volume', value, currentFrame);
    },
    [audioItemsById, currentFrame, keyframesByItemId],
  );

  const handleVolumeLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { volume: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { volume: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew],
  );

  const handleVolumeChange = useCallback(
    (value: number) => {
      const autoOps: AutoKeyframeOperation[] = [];
      const fallbackItemIds: string[] = [];
      for (const itemId of itemIds) {
        const operation = autoKeyframeVolume(itemId, value);
        if (operation) {
          autoOps.push(operation);
        } else {
          fallbackItemIds.push(itemId);
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (fallbackItemIds.length > 0) {
        fallbackItemIds.forEach((id) => updateItem(id, { volume: value }));
      }
      queueMicrotask(() => clearPreview());
    },
    [applyAutoKeyframeOperations, autoKeyframeVolume, clearPreview, itemIds, updateItem],
  );

  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeIn: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeIn: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew],
  );

  const handleFadeInChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeIn: value }));
      queueMicrotask(() => clearPreview());
    },
    [clearPreview, itemIds, updateItem],
  );

  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeOut: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeOut: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew],
  );

  const handleFadeOutChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeOut: value }));
      queueMicrotask(() => clearPreview());
    },
    [clearPreview, itemIds, updateItem],
  );

  const handleAudioPitchLiveChange = useCallback(
    (field: 'audioPitchSemitones' | 'audioPitchCents', value: number) => {
      const previews: Record<string, Pick<TimelineItem, 'audioPitchSemitones' | 'audioPitchCents'>> = {};
      itemIds.forEach((id) => {
        previews[id] = { [field]: value } as Pick<TimelineItem, 'audioPitchSemitones' | 'audioPitchCents'>;
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew],
  );

  const handleAudioPitchChange = useCallback(
    (field: 'audioPitchSemitones' | 'audioPitchCents', value: number) => {
      const previews: Record<string, Pick<TimelineItem, 'audioPitchSemitones' | 'audioPitchCents'>> = {};
      itemIds.forEach((id) => {
        previews[id] = { [field]: value } as Pick<TimelineItem, 'audioPitchSemitones' | 'audioPitchCents'>;
      });
      setPropertiesPreviewNew(previews);
      itemIds.forEach((id) => updateItem(id, { [field]: value } as Partial<TimelineItem>));

      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16);

      schedule(() => {
        schedule(() => {
          const currentItems = useTimelineStore.getState().items;
          const commitLanded = currentItems.every((item) =>
            !itemIds.includes(item.id) || (item[field] ?? 0) === value,
          );

          if (!commitLanded) {
            queueMicrotask(() => clearPreviewForItems(itemIds));
            return;
          }

          clearPreviewForItems(itemIds);
        });
      });
    },
    [clearPreviewForItems, itemIds, setPropertiesPreviewNew, updateItem],
  );

  const handleEqPatchLiveChange = useCallback(
    (patch: AudioEqPatch) => {
      const normalizedPatch = normalizeUiEqPatch(patch);
      const previews: Record<string, AudioEqPatch> = {};
      itemIds.forEach((id) => {
        previews[id] = normalizedPatch;
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew],
  );

  const handleEqPatchChange = useCallback(
    (patch: AudioEqPatch) => {
      const normalizedPatch = toTimelineEqPatch(patch);
      itemIds.forEach((id) => updateItem(id, normalizedPatch));
      queueMicrotask(() => clearPreview());
    },
    [clearPreview, itemIds, updateItem],
  );

  const handleEqPresetChange = useCallback((presetId: string) => {
    const preset = getAudioEqPresetById(presetId as AudioEqPresetId);
    if (!preset) return;

    const patch = buildTimelineEqPatchFromResolvedSettings(preset.settings);
    itemIds.forEach((id) => updateItem(id, patch));
    queueMicrotask(() => clearPreview());
  }, [clearPreview, itemIds, updateItem]);

  const handleResetVolume = useCallback(() => {
    const tolerance = 0.1;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && Math.abs(item.volume ?? 0) > tolerance,
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { volume: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleResetFadeIn = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioFadeIn ?? 0) > tolerance,
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioFadeIn: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleResetFadeOut = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioFadeOut ?? 0) > tolerance,
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioFadeOut: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleResetPitchSemitones = useCallback(() => {
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioPitchSemitones ?? 0) !== 0,
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioPitchSemitones: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleResetPitchCents = useCallback(() => {
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioPitchCents ?? 0) !== 0,
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioPitchCents: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleEqFieldChange = useCallback(
    <K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => {
      handleEqPatchChange({ [field]: value } as AudioEqPatch);
    },
    [handleEqPatchChange],
  );

  if (audioItems.length === 0) return null;

  return (
    <PropertySection title="Audio" icon={Volume2} defaultOpen={true}>
      <PropertyRow label="Gain">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={volume}
            onChange={handleVolumeChange}
            onLiveChange={handleVolumeLiveChange}
            min={AUDIO_GAIN_DB_MIN}
            max={AUDIO_GAIN_DB_MAX}
            step={0.1}
            unit="dB"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="volume"
            currentValue={volume === 'mixed' ? 0 : volume}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetVolume}
            title="Reset to 0 dB"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Semi Tones">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={pitchSemitones}
            onChange={(value) => handleAudioPitchChange('audioPitchSemitones', value)}
            onLiveChange={(value) => handleAudioPitchLiveChange('audioPitchSemitones', value)}
            min={AUDIO_PITCH_SEMITONES_MIN}
            max={AUDIO_PITCH_SEMITONES_MAX}
            step={1}
            unit="st"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetPitchSemitones}
            title="Reset semitone pitch"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Cents">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={pitchCents}
            onChange={(value) => handleAudioPitchChange('audioPitchCents', value)}
            onLiveChange={(value) => handleAudioPitchLiveChange('audioPitchCents', value)}
            min={AUDIO_PITCH_CENTS_MIN}
            max={AUDIO_PITCH_CENTS_MAX}
            step={1}
            unit="ct"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetPitchCents}
            title="Reset cent pitch"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Preset">
        <Select
          value={selectedEqPresetId ?? undefined}
          onValueChange={handleEqPresetChange}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
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
      </PropertyRow>

      <PropertyRow label="Curve" className="items-start">
        <AudioEqCurveEditor
          settings={eqCurveSettings}
          disabled={hasMixedEqSettings}
          onLiveChange={handleEqPatchLiveChange}
          onChange={handleEqPatchChange}
        />
      </PropertyRow>

      <PropertyRow label="Low Cut">
        <div className="flex items-center gap-1 w-full">
          <div className="flex items-center gap-1 pr-1">
            <Switch
              checked={eqLowCutEnabled === 'mixed' ? false : eqLowCutEnabled}
              onCheckedChange={(checked) => handleEqFieldChange('audioEqLowCutEnabled', checked)}
              className={eqLowCutEnabled === 'mixed' ? 'opacity-60' : undefined}
            />
            {eqLowCutEnabled === 'mixed' ? (
              <span className="text-[10px] text-muted-foreground">Mixed</span>
            ) : null}
          </div>
          <NumberInput
            value={eqLowCutFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqLowCutFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowCutFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <Select
            value={(eqLowCutSlopeDbPerOct === 'mixed' ? undefined : String(eqLowCutSlopeDbPerOct)) ?? undefined}
            onValueChange={(value) => handleEqFieldChange('audioEqLowCutSlopeDbPerOct', Number(value) as 6 | 12 | 18 | 24)}
          >
            <SelectTrigger className="h-7 text-xs w-[76px] flex-none">
              <SelectValue placeholder={eqLowCutSlopeDbPerOct === 'mixed' ? 'Mixed' : 'Slope'} />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_EQ_SLOPE_OPTIONS.map((slope) => (
                <SelectItem key={slope} value={String(slope)} className="text-xs">
                  {slope} dB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqLowCutEnabled: false,
              audioEqLowCutFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
              audioEqLowCutSlopeDbPerOct: 12,
            })}
            title="Reset low cut"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Low">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={eqLowFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqLowFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_LOW_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_LOW_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqLow}
            onChange={(value) => handleEqFieldChange('audioEqLowGainDb', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowGainDb: value })}
            label="G"
            unit="dB"
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            className="w-[92px] flex-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqLowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
              audioEqLowGainDb: 0,
            })}
            title="Reset low band"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Low Mid">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={eqLowMidFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqLowMidFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqLowMid}
            onChange={(value) => handleEqFieldChange('audioEqLowMidGainDb', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowMidGainDb: value })}
            label="G"
            unit="dB"
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqLowMidQ}
            onChange={(value) => handleEqFieldChange('audioEqLowMidQ', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqLowMidQ: value })}
            label="Q"
            min={0.3}
            max={8}
            step={0.05}
            className="w-[72px] flex-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqLowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
              audioEqLowMidGainDb: 0,
              audioEqLowMidQ: AUDIO_EQ_LOW_MID_Q,
            })}
            title="Reset low-mid band"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="High Mid">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={eqHighMidFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqHighMidFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqHighMid}
            onChange={(value) => handleEqFieldChange('audioEqHighMidGainDb', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighMidGainDb: value })}
            label="G"
            unit="dB"
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqHighMidQ}
            onChange={(value) => handleEqFieldChange('audioEqHighMidQ', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighMidQ: value })}
            label="Q"
            min={0.3}
            max={8}
            step={0.05}
            className="w-[72px] flex-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqHighMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
              audioEqHighMidGainDb: 0,
              audioEqHighMidQ: AUDIO_EQ_HIGH_MID_Q,
            })}
            title="Reset high-mid band"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="High">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={eqHighFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqHighFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <NumberInput
            value={eqHigh}
            onChange={(value) => handleEqFieldChange('audioEqHighGainDb', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighGainDb: value })}
            label="G"
            unit="dB"
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            className="w-[92px] flex-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqHighFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
              audioEqHighGainDb: 0,
            })}
            title="Reset high band"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="High Cut">
        <div className="flex items-center gap-1 w-full">
          <div className="flex items-center gap-1 pr-1">
            <Switch
              checked={eqHighCutEnabled === 'mixed' ? false : eqHighCutEnabled}
              onCheckedChange={(checked) => handleEqFieldChange('audioEqHighCutEnabled', checked)}
              className={eqHighCutEnabled === 'mixed' ? 'opacity-60' : undefined}
            />
            {eqHighCutEnabled === 'mixed' ? (
              <span className="text-[10px] text-muted-foreground">Mixed</span>
            ) : null}
          </div>
          <NumberInput
            value={eqHighCutFrequencyHz}
            onChange={(value) => handleEqFieldChange('audioEqHighCutFrequencyHz', value)}
            onLiveChange={(value) => handleEqPatchLiveChange({ audioEqHighCutFrequencyHz: value })}
            label="F"
            unit="Hz"
            min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ}
            max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ}
            step={1}
            className="w-[92px] flex-none"
          />
          <Select
            value={(eqHighCutSlopeDbPerOct === 'mixed' ? undefined : String(eqHighCutSlopeDbPerOct)) ?? undefined}
            onValueChange={(value) => handleEqFieldChange('audioEqHighCutSlopeDbPerOct', Number(value) as 6 | 12 | 18 | 24)}
          >
            <SelectTrigger className="h-7 text-xs w-[76px] flex-none">
              <SelectValue placeholder={eqHighCutSlopeDbPerOct === 'mixed' ? 'Mixed' : 'Slope'} />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_EQ_SLOPE_OPTIONS.map((slope) => (
                <SelectItem key={slope} value={String(slope)} className="text-xs">
                  {slope} dB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleEqPatchChange({
              audioEqHighCutEnabled: false,
              audioEqHighCutFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
              audioEqHighCutSlopeDbPerOct: 12,
            })}
            title="Reset high cut"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Fade In">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={fadeIn}
            onChange={handleFadeInChange}
            onLiveChange={handleFadeInLiveChange}
            min={0}
            max={5}
            step={0.1}
            unit="s"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetFadeIn}
            title="Reset to 0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Fade Out">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={fadeOut}
            onChange={handleFadeOutChange}
            onLiveChange={handleFadeOutLiveChange}
            min={0}
            max={5}
            step={0.1}
            unit="s"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetFadeOut}
            title="Reset to 0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  );
}
