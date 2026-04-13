import { useCallback, useMemo, useRef } from 'react';
import { Music, RotateCcw, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
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
import { PropertyRow, PropertySection, SliderInput } from '../components';
import { getMixedValue } from '../utils';
import { getAudioSectionItems } from './audio-section-utils';
import { AudioEqPanelContent } from './audio-eq-panel-content';
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

  const pitchPreviewOpRef = useRef(0);

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
      const opId = ++pitchPreviewOpRef.current;
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
          if (pitchPreviewOpRef.current !== opId) return;

          const currentItems = useTimelineStore.getState().items;
          const commitLanded = currentItems.every((item) =>
            !itemIds.includes(item.id) || (item[field] ?? 0) === value,
          );

          if (!commitLanded) {
            queueMicrotask(() => {
              if (pitchPreviewOpRef.current === opId) {
                clearPreviewForItems(itemIds);
              }
            });
            return;
          }

          clearPreviewForItems(itemIds);
        });
      });
    },
    [clearPreviewForItems, itemIds, setPropertiesPreviewNew, updateItem],
  );

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

  if (audioItems.length === 0) return null;

  return (
    <>
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

      <PropertySection title="Pitch" icon={Music} defaultOpen={true}>
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
      </PropertySection>

      <PropertySection title="Equalizer" defaultOpen={true}>
        <AudioEqPanelContent items={items} targetLabel="" layoutMode="compact" />
      </PropertySection>
    </>
  );
}
