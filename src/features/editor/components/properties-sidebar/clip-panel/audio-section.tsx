import { useCallback, useMemo } from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';

interface AudioSectionProps {
  items: TimelineItem[];
}

type MixedValue = number | 'mixed';

type AudioCapableItem = VideoItem | AudioItem;

/**
 * Get a value from audio-capable items, returning 'mixed' if they differ.
 */
function getMixedAudioValue(
  items: TimelineItem[],
  getter: (item: AudioCapableItem) => number | undefined,
  defaultValue = 0
): MixedValue {
  const audioItems = items.filter(
    (item): item is AudioCapableItem =>
      item.type === 'video' || item.type === 'audio'
  );
  if (audioItems.length === 0) return defaultValue;

  const values = audioItems.map((item) => getter(item) ?? defaultValue);
  const firstValue = values[0]!; // Safe: audioItems.length > 0 checked above
  return values.every((v) => Math.abs(v - firstValue) < 0.01) ? firstValue : 'mixed';
}

/**
 * Audio section - volume and audio fades.
 * Shown for video and audio clips.
 */
export function AudioSection({ items }: AudioSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);

  // Gizmo store for live audio preview
  const setItemPropertiesPreview = useGizmoStore((s) => s.setItemPropertiesPreview);
  const clearItemPropertiesPreview = useGizmoStore((s) => s.clearItemPropertiesPreview);

  const audioItems = useMemo(
    () =>
      items.filter(
        (item): item is AudioCapableItem =>
          item.type === 'video' || item.type === 'audio'
      ),
    [items]
  );

  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems]);

  // Get current values (volume in dB, defaults to 0 dB = unity gain)
  const volume = getMixedAudioValue(audioItems, (item) => item.volume, 0);
  const fadeIn = getMixedAudioValue(audioItems, (item) => item.audioFadeIn);
  const fadeOut = getMixedAudioValue(audioItems, (item) => item.audioFadeOut);

  // Live preview for volume (during drag)
  const handleVolumeLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { volume: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { volume: value };
      });
      setItemPropertiesPreview(previews);
    },
    [itemIds, setItemPropertiesPreview]
  );

  // Commit volume (on mouse up)
  // Update store first, then clear preview to avoid flicker
  const handleVolumeChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { volume: value }));
      // Defer preview clear to next microtask so store update propagates first
      queueMicrotask(() => clearItemPropertiesPreview());
    },
    [itemIds, updateItem, clearItemPropertiesPreview]
  );

  // Live preview for audio fade in (during drag)
  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeIn: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeIn: value };
      });
      setItemPropertiesPreview(previews);
    },
    [itemIds, setItemPropertiesPreview]
  );

  // Commit audio fade in (on mouse up)
  const handleFadeInChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeIn: value }));
      queueMicrotask(() => clearItemPropertiesPreview());
    },
    [itemIds, updateItem, clearItemPropertiesPreview]
  );

  // Live preview for audio fade out (during drag)
  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { audioFadeOut: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { audioFadeOut: value };
      });
      setItemPropertiesPreview(previews);
    },
    [itemIds, setItemPropertiesPreview]
  );

  // Commit audio fade out (on mouse up)
  const handleFadeOutChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { audioFadeOut: value }));
      queueMicrotask(() => clearItemPropertiesPreview());
    },
    [itemIds, updateItem, clearItemPropertiesPreview]
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

  if (audioItems.length === 0) return null;

  // Format volume in dB
  const formatVolume = (v: number) => {
    if (v > 0) return `+${v.toFixed(1)} dB`;
    if (v < 0) return `${v.toFixed(1)} dB`;
    return '0.0 dB';
  };

  return (
    <PropertySection title="Audio" icon={Volume2} defaultOpen={true}>
      {/* Volume in dB (-60 to +20, 0 dB = unity gain) */}
      <PropertyRow label="Volume">
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={volume}
            onChange={handleVolumeChange}
            onLiveChange={handleVolumeLiveChange}
            min={-60}
            max={20}
            step={0.1}
            formatValue={formatVolume}
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

      {/* Audio Fades */}
      <PropertyRow label="Fade In">
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={fadeIn}
            onChange={handleFadeInChange}
            onLiveChange={handleFadeInLiveChange}
            min={0}
            max={5}
            step={0.1}
            unit="s"
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
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={fadeOut}
            onChange={handleFadeOutChange}
            onLiveChange={handleFadeOutLiveChange}
            min={0}
            max={5}
            step={0.1}
            unit="s"
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
