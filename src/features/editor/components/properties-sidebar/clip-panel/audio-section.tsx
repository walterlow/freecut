import { useCallback, useMemo } from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview';
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

  // Get current playhead frame for keyframe animation (throttled to reduce re-renders)
  const currentFrame = useThrottledFrame();

  // Get keyframes for all selected items
  const allKeyframes = useTimelineStore((s) => s.keyframes);

  // Get batched keyframe action for auto-keyframing
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations);

  const audioItems = useMemo(
    () =>
      items.filter(
        (item): item is AudioCapableItem =>
          item.type === 'video' || item.type === 'audio'
      ),
    [items]
  );

  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems]);

  // Get current values with keyframe animation applied
  const volume = useMemo(() => {
    if (audioItems.length === 0) return 0 as number | 'mixed';

    const values = audioItems.map((item) => {
      const staticVolume = item.volume ?? 0;
      const itemKeyframes = allKeyframes.find((k) => k.itemId === item.id);
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
  }, [audioItems, allKeyframes, currentFrame]);

  const fadeIn = getMixedValue(audioItems, (item) => item.audioFadeIn, 0);
  const fadeOut = getMixedValue(audioItems, (item) => item.audioFadeOut, 0);

  // Helper: auto-keyframe volume on value change
  const autoKeyframeVolume = useCallback(
    (itemId: string, value: number): AutoKeyframeOperation | null => {
      const item = audioItems.find((i) => i.id === itemId);
      if (!item) return null;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return getAutoKeyframeOperation(item, itemKeyframes, 'volume', value, currentFrame);
    },
    [audioItems, allKeyframes, currentFrame]
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
      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = autoKeyframeVolume(itemId, value);
        if (operation) {
          autoOps.push(operation);
        } else {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (!allHandled) {
        itemIds.forEach((id) => updateItem(id, { volume: value }));
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
          <KeyframeToggle
            itemIds={itemIds}
            property="volume"
            currentValue={volume === 'mixed' ? 0 : volume}
          />
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

