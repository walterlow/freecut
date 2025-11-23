import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreviewZoom } from '../hooks/use-preview-zoom';

interface PreviewZoomControlsProps {
  containerWidth?: number;
  containerHeight?: number;
  projectWidth: number;
  projectHeight: number;
}

/**
 * Preview Zoom Controls Component
 *
 * Compact dropdown for zoom presets: Auto (fit), 25%, 50%, 100%
 */
export function PreviewZoomControls({
  containerWidth,
  containerHeight,
  projectWidth,
  projectHeight,
}: PreviewZoomControlsProps) {
  const { zoom, zoomPresets, handlePresetZoom } = usePreviewZoom({
    containerWidth,
    containerHeight,
    projectWidth,
    projectHeight,
  });

  // Get current zoom label
  const currentLabel = zoom === -1
    ? 'Auto'
    : zoomPresets.find((p) => p.value === zoom)?.label || `${Math.round(zoom * 100)}%`;

  const handleValueChange = (value: string) => {
    const preset = zoomPresets.find((p) => p.label === value);
    if (preset) {
      handlePresetZoom(preset);
    }
  };

  return (
    <Select value={currentLabel} onValueChange={handleValueChange}>
      <SelectTrigger className="w-20 h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {zoomPresets.map((preset) => (
          <SelectItem key={preset.label} value={preset.label} className="text-xs">
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
