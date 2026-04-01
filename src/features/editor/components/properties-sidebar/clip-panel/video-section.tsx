import { useCallback, useMemo } from 'react';
import { Crop, RotateCcw, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore } from '@/features/editor/deps/preview';
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store';
import { timelineToSourceFrames, sourceToTimelineFrames } from '@/features/editor/deps/timeline-utils';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';
import { getMixedValue } from '../utils';
import {
  cropPixelsToRatio,
  cropSignedPixelsToRatio,
  cropSignedRatioToPixels,
  cropRatioToPixels,
  getCropSoftnessReferenceDimension,
  normalizeCropSettings,
} from '@/shared/utils/media-crop';

// Speed limits (matching rate-stretch)
const MIN_SPEED = 0.1;
const MAX_SPEED = 10.0;
const CROP_STEP = 0.1;
const CROP_TOLERANCE = 0.01;

interface VideoSectionProps {
  items: TimelineItem[];
}

type CropEdge = 'left' | 'right' | 'top' | 'bottom';

function getSourceWidth(item: VideoItem): number {
  return Math.max(1, item.sourceWidth ?? item.transform?.width ?? 1920);
}

function getSourceHeight(item: VideoItem): number {
  return Math.max(1, item.sourceHeight ?? item.transform?.height ?? 1080);
}

function getCropPixels(item: VideoItem, edge: CropEdge): number {
  const dimension = edge === 'left' || edge === 'right'
    ? getSourceWidth(item)
    : getSourceHeight(item);
  return cropRatioToPixels(item.crop?.[edge], dimension);
}

function getCropSoftnessDimension(item: VideoItem): number {
  return Math.max(1, getCropSoftnessReferenceDimension(getSourceWidth(item), getSourceHeight(item)));
}

function getCropSoftnessPixels(item: VideoItem): number {
  return cropSignedRatioToPixels(item.crop?.softness, getCropSoftnessDimension(item));
}

function buildCropUpdate(item: VideoItem, edge: CropEdge, pixels: number) {
  const dimension = edge === 'left' || edge === 'right'
    ? getSourceWidth(item)
    : getSourceHeight(item);
  return normalizeCropSettings({
    ...item.crop,
    [edge]: cropPixelsToRatio(pixels, dimension),
  });
}

function buildCropSoftnessUpdate(item: VideoItem, pixels: number) {
  return normalizeCropSettings({
    ...item.crop,
    softness: cropSignedPixelsToRatio(pixels, getCropSoftnessDimension(item)),
  });
}

function formatCropValue(value: number): string {
  return value.toFixed(3);
}

/**
 * Playback section - playback rate, video fades, and edge crop.
 *
 * Speed changes affect clip duration (rate stretch behavior):
 * - Faster speed = shorter clip (same content plays faster)
 * - Slower speed = longer clip (same content plays slower)
 */
export function VideoSection({ items }: VideoSectionProps) {
  const rateStretchItem = useTimelineStore((s: TimelineState & TimelineActions) => s.rateStretchItem);
  const updateItem = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItem);

  // Gizmo store for live previews
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items]
  );

  // Memoize video item IDs for fade/crop controls (video-only)
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
  const cropLeft = getMixedValue(videoItems, (item) => getCropPixels(item, 'left'), 0);
  const cropRight = getMixedValue(videoItems, (item) => getCropPixels(item, 'right'), 0);
  const cropTop = getMixedValue(videoItems, (item) => getCropPixels(item, 'top'), 0);
  const cropBottom = getMixedValue(videoItems, (item) => getCropPixels(item, 'bottom'), 0);
  const cropSoftness = getMixedValue(videoItems, getCropSoftnessPixels, 0);

  const maxSourceWidth = useMemo(
    () => Math.max(1, ...videoItems.map(getSourceWidth)),
    [videoItems]
  );
  const maxSourceHeight = useMemo(
    () => Math.max(1, ...videoItems.map(getSourceHeight)),
    [videoItems]
  );
  const maxCropSoftness = useMemo(
    () => Math.max(1, ...videoItems.map(getCropSoftnessDimension)),
    [videoItems]
  );

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
          // Calculate new duration based on new speed using FPS-aware conversion.
          const newDuration = Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, clampedSpeed, sourceFps, fps));
          // Keep start position the same (stretch from end)
          rateStretchItem(item.id, item.from, newDuration, clampedSpeed);
        });
    },
    [rateStretchableIds, rateStretchItem]
  );

  const commitPreviewClear = useCallback(() => {
    queueMicrotask(() => clearPreview());
  }, [clearPreview]);

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
      commitPreviewClear();
    },
    [itemIds, updateItem, commitPreviewClear]
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
      commitPreviewClear();
    },
    [itemIds, updateItem, commitPreviewClear]
  );

  const previewCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      const previews: Record<string, { crop: VideoItem['crop'] }> = {};
      videoItems.forEach((item) => {
        previews[item.id] = {
          crop: buildCropUpdate(item, edge, pixels),
        };
      });
      setPropertiesPreviewNew(previews);
    },
    [setPropertiesPreviewNew, videoItems]
  );

  const commitCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      videoItems.forEach((item) => {
        updateItem(item.id, {
          crop: buildCropUpdate(item, edge, pixels),
        });
      });
      commitPreviewClear();
    },
    [videoItems, updateItem, commitPreviewClear]
  );

  const previewCropSoftness = useCallback(
    (pixels: number) => {
      const previews: Record<string, { crop: VideoItem['crop'] }> = {};
      videoItems.forEach((item) => {
        previews[item.id] = {
          crop: buildCropSoftnessUpdate(item, pixels),
        };
      });
      setPropertiesPreviewNew(previews);
    },
    [setPropertiesPreviewNew, videoItems]
  );

  const commitCropSoftness = useCallback(
    (pixels: number) => {
      videoItems.forEach((item) => {
        updateItem(item.id, {
          crop: buildCropSoftnessUpdate(item, pixels),
        });
      });
      commitPreviewClear();
    },
    [videoItems, updateItem, commitPreviewClear]
  );

  const resetCropEdge = useCallback(
    (edge: CropEdge) => {
      const needsUpdate = videoItems.some((item) => getCropPixels(item, edge) > CROP_TOLERANCE);
      if (!needsUpdate) return;

      videoItems.forEach((item) => {
        updateItem(item.id, {
          crop: normalizeCropSettings({
            ...item.crop,
            [edge]: 0,
          }),
        });
      });
    },
    [updateItem, videoItems]
  );

  const resetCropSoftness = useCallback(() => {
    const needsUpdate = videoItems.some((item) => Math.abs(getCropSoftnessPixels(item)) > CROP_TOLERANCE);
    if (!needsUpdate) return;

    videoItems.forEach((item) => {
      updateItem(item.id, {
        crop: normalizeCropSettings({
          ...item.crop,
          softness: 0,
        }),
      });
    });
  }, [updateItem, videoItems]);

  // Reset speed to 1x - pushes subsequent clips right to avoid overlaps
  const resetSpeedWithRipple = useTimelineStore((s: TimelineState & TimelineActions) => s.resetSpeedWithRipple);
  const handleResetSpeed = useCallback(() => {
    resetSpeedWithRipple(rateStretchableIds);
  }, [rateStretchableIds, resetSpeedWithRipple]);

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
    <>
      <PropertySection title="Playback" icon={Video} defaultOpen={true}>
        {/* Playback Rate - affects clip duration */}
        <PropertyRow label="Speed">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
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

      <PropertySection title="Cropping" icon={Crop} defaultOpen={true}>
        <PropertyRow label="Left">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropLeft}
              onChange={(value) => commitCropEdge('left', value)}
              onLiveChange={(value) => previewCropEdge('left', value)}
              min={0}
              max={maxSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('left')}
              title="Reset left crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Right">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropRight}
              onChange={(value) => commitCropEdge('right', value)}
              onLiveChange={(value) => previewCropEdge('right', value)}
              min={0}
              max={maxSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('right')}
              title="Reset right crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Top">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropTop}
              onChange={(value) => commitCropEdge('top', value)}
              onLiveChange={(value) => previewCropEdge('top', value)}
              min={0}
              max={maxSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('top')}
              title="Reset top crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Bottom">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropBottom}
              onChange={(value) => commitCropEdge('bottom', value)}
              onLiveChange={(value) => previewCropEdge('bottom', value)}
              min={0}
              max={maxSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('bottom')}
              title="Reset bottom crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Softness">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropSoftness}
              onChange={commitCropSoftness}
              onLiveChange={previewCropSoftness}
              min={-maxCropSoftness}
              max={maxCropSoftness}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={resetCropSoftness}
              title="Reset crop softness"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>
    </>
  );
}
