import { useCallback, useMemo } from 'react';
import { Video, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore } from '@/features/editor/deps/preview';
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store';
import { timelineToSourceFrames, sourceToTimelineFrames } from '@/features/editor/deps/timeline-utils';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
} from '../components';
import { getMixedValue } from '../utils';

// Speed limits (matching rate-stretch)
const MIN_SPEED = 0.1;
const MAX_SPEED = 10.0;

interface VideoSectionProps {
  items: TimelineItem[];
}

/**
 * Video section - playback rate and video fades.
 * Only shown when selection includes video clips.
 *
 * Speed changes affect clip duration (rate stretch behavior):
 * - Faster speed = shorter clip (same content plays faster)
 * - Slower speed = longer clip (same content plays slower)
 */
export function VideoSection({ items }: VideoSectionProps) {
  const rateStretchItem = useTimelineStore((s: TimelineState & TimelineActions) => s.rateStretchItem);
  const updateItem = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItem);

  // Gizmo store for live fade preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items]
  );

  // Memoize video item IDs for fade controls (video-only)
  const itemIds = useMemo(() => videoItems.map((item) => item.id), [videoItems]);

  // Memoize IDs for rate-stretch: includes audio items too so detached audio tracks
  // stay in sync when speed is changed via the properties panel.
  const rateStretchableIds = useMemo(
    () => items
      .filter((item): item is VideoItem | AudioItem => item.type === 'video' || item.type === 'audio')
      .map((item) => item.id),
    [items]
  );

  // Get current values (speed defaults to 1, fades default to 0)
  const speed = getMixedValue(videoItems, (item) => item.speed, 1);
  const fadeIn = getMixedValue(videoItems, (item) => item.fadeIn, 0);
  const fadeOut = getMixedValue(videoItems, (item) => item.fadeOut, 0);

  // Handle speed change - uses rate stretch to adjust duration
  // Read current values from store to avoid depending on videoItems
  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      // Round to 2 decimal places to match clip label precision and avoid floating point drift
      const roundedSpeed = Math.round(newSpeed * 100) / 100;
      // Clamp speed to valid range
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, roundedSpeed));

      const { items: currentItems, fps } = useTimelineStore.getState();
      currentItems
        .filter((item: TimelineItem): item is VideoItem | AudioItem =>
          (item.type === 'video' || item.type === 'audio') && rateStretchableIds.includes(item.id))
        .forEach((item: VideoItem | AudioItem) => {
          const currentSpeed = item.speed || 1;
          const sourceFps = item.sourceFps ?? fps;
          // For split clips with explicit source bounds, use the actual source span.
          // This is more accurate than durationInFrames * currentSpeed, which can
          // drift with rounding across multiple speed changes or mismatched FPS.
          const effectiveSourceFrames =
            item.sourceEnd !== undefined && item.sourceStart !== undefined
              ? item.sourceEnd - item.sourceStart
              : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps);
          // Calculate new duration based on new speed — FPS-aware conversion so
          // 23.981fps source clips get the correct timeline duration.
          const newDuration = Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, clampedSpeed, sourceFps, fps));
          // Keep start position the same (stretch from end)
          rateStretchItem(item.id, item.from, newDuration, clampedSpeed);
        });
    },
    [rateStretchableIds, rateStretchItem]
  );

  // Live preview for fade in (during drag)
  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeIn: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { fadeIn: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit fade in (on mouse up)
  const handleFadeInChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { fadeIn: value }));
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
  );

  // Live preview for fade out (during drag)
  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeOut: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { fadeOut: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit fade out (on mouse up)
  const handleFadeOutChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { fadeOut: value }));
      queueMicrotask(() => clearPreview());
    },
    [itemIds, updateItem, clearPreview]
  );

  // Reset speed to 1x
  // Read current values from store to avoid depending on videoItems (prevents callback recreation)
  const handleResetSpeed = useCallback(() => {
    const tolerance = 0.01;
    const { items: currentItems, fps } = useTimelineStore.getState();
    currentItems
      .filter((item: TimelineItem): item is VideoItem | AudioItem =>
        (item.type === 'video' || item.type === 'audio') && rateStretchableIds.includes(item.id))
      .forEach((item: VideoItem | AudioItem) => {
        const currentSpeed = item.speed || 1;
        if (Math.abs(currentSpeed - 1) <= tolerance) return;

        const sourceFps = item.sourceFps ?? fps;
        const effectiveSourceFrames =
          item.sourceEnd !== undefined && item.sourceStart !== undefined
            ? item.sourceEnd - item.sourceStart
            : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps);
        // At 1x speed, timeline frames = source frames converted to timeline FPS
        const newDuration = Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, 1, sourceFps, fps));
        rateStretchItem(item.id, item.from, newDuration, 1);
      });
  }, [rateStretchableIds, rateStretchItem]);

  // Reset fade in to 0
  const handleResetFadeIn = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item: TimelineItem) => itemIds.includes(item.id) && ((item as VideoItem).fadeIn ?? 0) > tolerance
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { fadeIn: 0 }));
    }
  }, [itemIds, updateItem]);

  // Reset fade out to 0
  const handleResetFadeOut = useCallback(() => {
    const tolerance = 0.01;
    const currentItems = useTimelineStore.getState().items;
    const needsUpdate = currentItems.some(
      (item: TimelineItem) => itemIds.includes(item.id) && ((item as VideoItem).fadeOut ?? 0) > tolerance
    );
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { fadeOut: 0 }));
    }
  }, [itemIds, updateItem]);

  if (videoItems.length === 0) return null;

  return (
    <PropertySection title="Video" icon={Video} defaultOpen={true}>
      {/* Playback Rate - affects clip duration */}
      <PropertyRow label="Speed">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={speed}
            onChange={handleSpeedChange}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.01}
            unit="x"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetSpeed}
            title="Reset to 1x"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Video Fades */}
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

