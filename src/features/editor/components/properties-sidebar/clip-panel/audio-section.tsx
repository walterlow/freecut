import { useCallback, useMemo } from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
} from '../components';
import { getMixedValue } from '../utils';

interface AudioSectionProps {
  items: TimelineItem[];
}

type AudioCapableItem = VideoItem | AudioItem;

/**
 * Audio section - volume and audio fades.
 * Shown for video and audio clips.
 */
export function AudioSection({ items }: AudioSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);

  // Gizmo store for live audio preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

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
  const volume = getMixedValue(audioItems, (item) => item.volume, 0);
  const fadeIn = getMixedValue(audioItems, (item) => item.audioFadeIn, 0);
  const fadeOut = getMixedValue(audioItems, (item) => item.audioFadeOut, 0);

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

  // Commit volume (on mouse up)
  // Update store first, then clear preview to avoid flicker
  const handleVolumeChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { volume: value }));
      // Defer preview clear to next microtask so store update propagates first
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
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

  return (
    <PropertySection title="Audio" icon={Volume2} defaultOpen={true}>
      {/* Volume in dB (-60 to +20, 0 dB = unity gain) */}
      <PropertyRow label="Gain">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={volume}
            onChange={handleVolumeChange}
            onLiveChange={handleVolumeLiveChange}
            min={-60}
            max={20}
            step={0.1}
            unit="dB"
            className="flex-1 min-w-0"
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
        <div className="flex items-center gap-1 w-full">
          <NumberInput
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
          <NumberInput
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
