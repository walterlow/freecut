import { useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';

/**
 * Zoom presets for preview
 */
const ZOOM_PRESETS = [
  { label: 'Auto', value: 'fit' as const },
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
] as const;

type ZoomPreset = (typeof ZOOM_PRESETS)[number];

/**
 * Hook for managing preview zoom level
 *
 * Provides:
 * - Current zoom level from store
 * - Preset zoom levels (Fit, 50%, 100%, 200%)
 * - Fine-tune zoom setter
 * - Fit-to-viewport calculation
 *
 * @returns Zoom state and controls
 */
export function usePreviewZoom() {
  const zoom = usePlaybackStore((s) => s.zoom);
  const setZoom = usePlaybackStore((s) => s.setZoom);

  /**
   * Handle preset zoom selection
   */
  const handlePresetZoom = useCallback(
    (preset: ZoomPreset) => {
      if (preset.value === 'fit') {
        // Set to -1 to enable auto-fit mode
        setZoom(-1);
      } else {
        setZoom(preset.value);
      }
    },
    [setZoom]
  );

  /**
   * Zoom in by 20%
   */
  const zoomIn = useCallback(() => {
    setZoom(Math.min(2, Number((zoom * 1.2).toFixed(2))));
  }, [zoom, setZoom]);

  /**
   * Zoom out by 20%
   */
  const zoomOut = useCallback(() => {
    setZoom(Math.max(0.1, Number((zoom / 1.2).toFixed(2))));
  }, [zoom, setZoom]);

  /**
   * Reset zoom to 100%
   */
  const resetZoom = useCallback(() => {
    setZoom(1);
  }, [setZoom]);

  return {
    zoom,
    setZoom,
    zoomPresets: ZOOM_PRESETS,
    handlePresetZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
