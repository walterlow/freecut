import { useCallback, useMemo } from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/types/timeline';
import { useKeyframesStore, useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview';
import type { ItemPropertiesPreview } from '@/features/preview/stores/gizmo-store';
import {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
  getPropertyKeyframes,
  interpolatePropertyValue,
  KeyframeToggle,
} from '@/features/editor/deps/keyframes';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';
import { getMixedValue } from '../utils';
import { getAudioSectionItems } from './audio-section-utils';
import { AUDIO_EQ_GAIN_DB_MAX, AUDIO_EQ_GAIN_DB_MIN } from '@/shared/utils/audio-eq';

interface AudioSectionProps {
  items: TimelineItem[];
}

const AUDIO_GAIN_DB_MIN = -60;
const AUDIO_GAIN_DB_MAX = 12;
type AudioEqField = 'audioEqLowGainDb' | 'audioEqMidGainDb' | 'audioEqHighGainDb';

/**
 * Audio section - volume and audio fades.
 * Shown for video and audio clips.
 */
export function AudioSection({ items }: AudioSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);

  // Gizmo store for live audio preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  // Get current playhead frame for keyframe animation (throttled to reduce re-renders)
  const currentFrame = useThrottledFrame();

  // Get batched keyframe action for auto-keyframing
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations);

  const audioItems = useMemo(
    () => getAudioSectionItems(items),
    [items]
  );

  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems]);
  const audioItemsById = useMemo(() => new Map(audioItems.map((item) => [item.id, item])), [audioItems]);
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback(
        (s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null),
        [itemIds]
      )
    )
  );
  const keyframesByItemId = useMemo(() => {
    const map = new Map<string, (typeof itemKeyframes)[number]>();
    for (const [index, itemId] of itemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null);
    }
    return map;
  }, [itemIds, itemKeyframes]);

  // Get current values with keyframe animation applied
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
  }, [audioItems, keyframesByItemId, currentFrame]);

  const fadeIn = getMixedValue(audioItems, (item) => item.audioFadeIn, 0);
  const fadeOut = getMixedValue(audioItems, (item) => item.audioFadeOut, 0);
  const eqLow = getMixedValue(audioItems, (item) => item.audioEqLowGainDb, 0);
  const eqMid = getMixedValue(audioItems, (item) => item.audioEqMidGainDb, 0);
  const eqHigh = getMixedValue(audioItems, (item) => item.audioEqHighGainDb, 0);

  // Helper: auto-keyframe volume on value change
  const autoKeyframeVolume = useCallback(
    (itemId: string, value: number): AutoKeyframeOperation | null => {
      const item = audioItemsById.get(itemId);
      if (!item) return null;

      const itemKeyframes = keyframesByItemId.get(itemId) ?? undefined;
      return getAutoKeyframeOperation(item, itemKeyframes, 'volume', value, currentFrame);
    },
    [audioItemsById, currentFrame, keyframesByItemId]
  );

  // Live preview for volume (during drag)
  const handleVolumeLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { volume: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { volume: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit volume (on mouse up, with auto-keyframe support)
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
      // Defer preview clear to next microtask so store update propagates first
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview, autoKeyframeVolume, applyAutoKeyframeOperations]
  );

  // Live preview for audio fade in (during drag)
  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeIn: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeIn: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit audio fade in (on mouse up)
  const handleFadeInChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeIn: value }));
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
  );

  // Live preview for audio fade out (during drag)
  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeOut: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeOut: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit audio fade out (on mouse up)
  const handleFadeOutChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeOut: value }));
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
  );

  const handleEqLiveChange = useCallback(
    (field: AudioEqField, value: number) => {
      const previews: Record<string, ItemPropertiesPreview> = {};
      itemIds.forEach((id) => {
        previews[id] = { [field]: value } as ItemPropertiesPreview;
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  const handleEqChange = useCallback(
    (field: AudioEqField, value: number) => {
      itemIds.forEach((id) => updateItem(id, { [field]: value } as Partial<TimelineItem>));
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
  );

  // Reset volume to 0 dB
  // Read current values from store to avoid depending on audioItems (prevents callback recreation)
  const handleResetVolume = useCallback(() => {
    const tolerance = 0.1;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && Math.abs(item.volume ?? 0) > tolerance
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { volume: 0 }));
    }
  }, [itemIds, updateItem]);

  // Reset audio fade in to 0
  const handleResetFadeIn = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioFadeIn ?? 0) > tolerance
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioFadeIn: 0 }));
    }
  }, [itemIds, updateItem]);

  // Reset audio fade out to 0
  const handleResetFadeOut = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item) => itemIds.includes(item.id) && (item.audioFadeOut ?? 0) > tolerance
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { audioFadeOut: 0 }));
    }
  }, [itemIds, updateItem]);

  const handleResetEq = useCallback((field: AudioEqField) => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some((item) => {
      if (!itemIds.includes(item.id)) return false;
      return Math.abs((item[field] as number | undefined) ?? 0) > tolerance;
    });
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { [field]: 0 } as Partial<TimelineItem>));
    }
  }, [itemIds, updateItem]);

  if (audioItems.length === 0) return null;

  return (
    <PropertySection title="Audio" icon={Volume2} defaultOpen={true}>
      {/* Volume in dB (-60 to +12, 0 dB = unity gain) */}
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

      <PropertyRow label="Low EQ">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={eqLow}
            onChange={(value) => handleEqChange('audioEqLowGainDb', value)}
            onLiveChange={(value) => handleEqLiveChange('audioEqLowGainDb', value)}
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            unit="dB"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleResetEq('audioEqLowGainDb')}
            title="Reset to 0 dB"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Mid EQ">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={eqMid}
            onChange={(value) => handleEqChange('audioEqMidGainDb', value)}
            onLiveChange={(value) => handleEqLiveChange('audioEqMidGainDb', value)}
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            unit="dB"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleResetEq('audioEqMidGainDb')}
            title="Reset to 0 dB"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="High EQ">
        <div className="flex items-center gap-1 w-full">
          <SliderInput
            value={eqHigh}
            onChange={(value) => handleEqChange('audioEqHighGainDb', value)}
            onLiveChange={(value) => handleEqLiveChange('audioEqHighGainDb', value)}
            min={AUDIO_EQ_GAIN_DB_MIN}
            max={AUDIO_EQ_GAIN_DB_MAX}
            step={0.1}
            unit="dB"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => handleResetEq('audioEqHighGainDb')}
            title="Reset to 0 dB"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Audio Fades */}
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
