import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapPin, Trash2 } from 'lucide-react';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { PropertySection, PropertyRow, NumberInput, ColorPicker } from '../components';

const DEFAULT_MARKER_COLOR = 'oklch(0.65 0.20 250)';

// Preset colors for quick selection
const MARKER_PRESET_COLORS = [
  'oklch(0.65 0.20 250)', // Blue (default)
  'oklch(0.65 0.20 30)',  // Red
  'oklch(0.70 0.20 140)', // Green
  'oklch(0.70 0.18 85)',  // Yellow
  'oklch(0.60 0.20 310)', // Purple
  'oklch(0.70 0.15 180)', // Cyan
];

/**
 * Marker properties panel - shown when a marker is selected.
 * Allows editing frame position, label, and color.
 */
export function MarkerPanel() {
  // Granular selectors (Zustand v5 best practice)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const markers = useTimelineStore((s) => s.markers);
  const updateMarker = useTimelineStore((s) => s.updateMarker);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const fps = useTimelineStore((s) => s.fps);

  // Derive selected marker
  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId),
    [markers, selectedMarkerId]
  );

  // Handle frame change
  const handleFrameChange = useCallback(
    (frame: number) => {
      if (selectedMarkerId) {
        updateMarker(selectedMarkerId, { frame: Math.max(0, Math.round(frame)) });
      }
    },
    [selectedMarkerId, updateMarker]
  );

  // Handle label change
  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (selectedMarkerId) {
        // Store undefined if empty string to keep data clean
        updateMarker(selectedMarkerId, { label: e.target.value || undefined });
      }
    },
    [selectedMarkerId, updateMarker]
  );

  // Handle color change
  const handleColorChange = useCallback(
    (color: string) => {
      if (selectedMarkerId) {
        updateMarker(selectedMarkerId, { color });
      }
    },
    [selectedMarkerId, updateMarker]
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedMarkerId) {
      removeMarker(selectedMarkerId);
      clearSelection();
    }
  }, [selectedMarkerId, removeMarker, clearSelection]);

  // Handle reset color to default
  const handleResetColor = useCallback(() => {
    if (selectedMarkerId && selectedMarker?.color !== DEFAULT_MARKER_COLOR) {
      updateMarker(selectedMarkerId, { color: DEFAULT_MARKER_COLOR });
    }
  }, [selectedMarkerId, selectedMarker?.color, updateMarker]);

  // Format frame as timecode (MM:SS.FF)
  const formatTimecode = useCallback(
    (frame: number): string => {
      const totalSeconds = frame / fps;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const remainingFrames = frame % fps;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainingFrames).padStart(2, '0')}`;
    },
    [fps]
  );

  if (!selectedMarker) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <MapPin className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">Marker not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PropertySection title="Marker" icon={MapPin} defaultOpen={true}>
        {/* Frame position */}
        <PropertyRow label="Frame">
          <NumberInput
            value={selectedMarker.frame}
            onChange={handleFrameChange}
            min={0}
            step={1}
            className="flex-1 min-w-0"
          />
        </PropertyRow>

        {/* Timecode (read-only) */}
        <PropertyRow label="Time">
          <span className="text-xs font-mono text-muted-foreground">
            {formatTimecode(selectedMarker.frame)}
          </span>
        </PropertyRow>

        {/* Label */}
        <PropertyRow label="Label">
          <Input
            value={selectedMarker.label || ''}
            onChange={handleLabelChange}
            placeholder="Enter label..."
            className="h-7 text-xs flex-1 min-w-0"
          />
        </PropertyRow>

        {/* Color */}
        <ColorPicker
          label="Color"
          color={selectedMarker.color}
          onChange={handleColorChange}
          onReset={handleResetColor}
          defaultColor={DEFAULT_MARKER_COLOR}
          presets={MARKER_PRESET_COLORS}
        />

        {/* Delete button */}
        <div className="pt-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleDelete}
          >
            <Trash2 className="w-3 h-3 mr-1.5" />
            Delete Marker
          </Button>
        </div>
      </PropertySection>
    </div>
  );
}

