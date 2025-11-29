import { useCallback, useMemo } from 'react';
import { Video } from 'lucide-react';
import type { TimelineItem, VideoItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';

// Speed limits (matching rate-stretch)
const MIN_SPEED = 0.1;
const MAX_SPEED = 10.0;

/**
 * Convert speed to slider value using log scale.
 * This puts 1x at the center of the slider.
 * - Slider -1 = 0.1x speed
 * - Slider 0 = 1x speed (center)
 * - Slider +1 = 10x speed
 */
function speedToSlider(speed: number): number {
  return Math.log10(Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed)));
}

// Common speed values to snap to (in log scale: log10(speed))
const SNAP_POINTS = [
  { log: Math.log10(0.25), speed: 0.25 },  // 0.25x
  { log: Math.log10(0.5), speed: 0.5 },    // 0.5x
  { log: 0, speed: 1.0 },                   // 1x (center)
  { log: Math.log10(2), speed: 2.0 },      // 2x
  { log: Math.log10(4), speed: 4.0 },      // 4x
];
const SNAP_THRESHOLD = 0.03; // Snap when within this distance in log scale

/**
 * Convert slider value back to speed.
 * Snaps to common values (0.25x, 0.5x, 1x, 2x, 4x) for better UX.
 */
function sliderToSpeed(sliderValue: number): number {
  // Check for snap points
  for (const snap of SNAP_POINTS) {
    if (Math.abs(sliderValue - snap.log) < SNAP_THRESHOLD) {
      return snap.speed;
    }
  }
  return Math.pow(10, sliderValue);
}

interface VideoSectionProps {
  items: TimelineItem[];
}

type MixedValue = number | 'mixed';

/**
 * Get a value from video items, returning 'mixed' if they differ.
 */
function getMixedVideoValue(
  items: TimelineItem[],
  getter: (item: VideoItem) => number | undefined
): MixedValue {
  const videoItems = items.filter((item): item is VideoItem => item.type === 'video');
  if (videoItems.length === 0) return 1;

  const values = videoItems.map((item) => getter(item) ?? 1);
  const firstValue = values[0]!; // Safe: videoItems.length > 0 checked above
  return values.every((v) => Math.abs(v - firstValue) < 0.001) ? firstValue : 'mixed';
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
  const rateStretchItem = useTimelineStore((s) => s.rateStretchItem);
  const updateItem = useTimelineStore((s) => s.updateItem);

  // Gizmo store for live fade preview
  const setItemPropertiesPreview = useGizmoStore((s) => s.setItemPropertiesPreview);
  const clearItemPropertiesPreview = useGizmoStore((s) => s.clearItemPropertiesPreview);

  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items]
  );

  // Get current values
  const speed = getMixedVideoValue(videoItems, (item) => item.speed);
  const fadeIn = getMixedVideoValue(videoItems, (item) => item.fadeIn);
  const fadeOut = getMixedVideoValue(videoItems, (item) => item.fadeOut);

  // Convert speed to slider value (log scale, 1x at center)
  const sliderValue = speed === 'mixed' ? 'mixed' : speedToSlider(speed);

  // Handle speed change from slider - uses rate stretch to adjust duration
  const handleSliderChange = useCallback(
    (newSliderValue: number) => {
      const newSpeed = sliderToSpeed(newSliderValue);
      // Round to 2 decimal places to match clip label precision and avoid floating point drift
      const roundedSpeed = Math.round(newSpeed * 100) / 100;
      // Clamp speed to valid range
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, roundedSpeed));

      videoItems.forEach((item) => {
        const currentSpeed = item.speed || 1;
        // Use stored sourceDuration if available, otherwise calculate from current state
        // This prevents accumulated rounding errors from multiple speed changes
        const sourceDuration = item.sourceDuration
          ? Math.round(item.durationInFrames * currentSpeed) // Current visible frames
          : Math.round(item.durationInFrames * currentSpeed);
        // Calculate new duration based on new speed
        const newDuration = Math.max(1, Math.round(sourceDuration / clampedSpeed));
        // Keep start position the same (stretch from end)
        rateStretchItem(item.id, item.from, newDuration, clampedSpeed);
      });
    },
    [videoItems, rateStretchItem]
  );

  // Format slider value to display actual speed (2 decimal places to match clip label)
  const formatSpeed = useCallback((sliderVal: number) => {
    const actualSpeed = sliderToSpeed(sliderVal);
    // Round to 2 decimal places to match clip label
    const rounded = Math.round(actualSpeed * 100) / 100;
    return `${rounded.toFixed(2)}x`;
  }, []);

  // Live preview for fade in (during drag)
  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeIn: number }> = {};
      videoItems.forEach((item) => {
        previews[item.id] = { fadeIn: value };
      });
      setItemPropertiesPreview(previews);
    },
    [videoItems, setItemPropertiesPreview]
  );

  // Commit fade in (on mouse up)
  const handleFadeInChange = useCallback(
    (value: number) => {
      clearItemPropertiesPreview();
      videoItems.forEach((item) => updateItem(item.id, { fadeIn: value }));
    },
    [videoItems, updateItem, clearItemPropertiesPreview]
  );

  // Live preview for fade out (during drag)
  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeOut: number }> = {};
      videoItems.forEach((item) => {
        previews[item.id] = { fadeOut: value };
      });
      setItemPropertiesPreview(previews);
    },
    [videoItems, setItemPropertiesPreview]
  );

  // Commit fade out (on mouse up)
  const handleFadeOutChange = useCallback(
    (value: number) => {
      clearItemPropertiesPreview();
      videoItems.forEach((item) => updateItem(item.id, { fadeOut: value }));
    },
    [videoItems, updateItem, clearItemPropertiesPreview]
  );

  if (videoItems.length === 0) return null;

  return (
    <PropertySection title="Video" icon={Video} defaultOpen={true}>
      {/* Playback Rate - affects clip duration (log scale, 1x at center) */}
      <PropertyRow label="Speed">
        <SliderInput
          value={sliderValue}
          onChange={handleSliderChange}
          min={-1}
          max={1}
          step={0.02}
          formatValue={formatSpeed}
        />
      </PropertyRow>

      {/* Video Fades */}
      <PropertyRow label="Fade In">
        <SliderInput
          value={fadeIn}
          onChange={handleFadeInChange}
          onLiveChange={handleFadeInLiveChange}
          min={0}
          max={5}
          step={0.1}
          unit="s"
        />
      </PropertyRow>

      <PropertyRow label="Fade Out">
        <SliderInput
          value={fadeOut}
          onChange={handleFadeOutChange}
          onLiveChange={handleFadeOutLiveChange}
          min={0}
          max={5}
          step={0.1}
          unit="s"
        />
      </PropertyRow>
    </PropertySection>
  );
}
