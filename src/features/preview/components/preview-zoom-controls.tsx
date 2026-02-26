import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreviewZoom } from '../hooks/use-preview-zoom';
import { usePlaybackStore } from '../stores/playback-store';
import type { PreviewQuality } from '../types';

const QUALITY_PRESETS: { label: string; value: PreviewQuality }[] = [
  { label: 'Full', value: 1 },
  { label: 'Half', value: 0.5 },
  { label: 'Quarter', value: 0.25 },
];

export function PreviewZoomControls() {
  const { zoom, zoomPresets, handlePresetZoom } = usePreviewZoom();
  const previewQuality = usePlaybackStore((s) => s.previewQuality);
  const setPreviewQuality = usePlaybackStore((s) => s.setPreviewQuality);

  const currentLabel = zoom === -1
    ? 'Auto'
    : zoomPresets.find((p) => p.value === zoom)?.label || `${Math.round(zoom * 100)}%`;

  const handleValueChange = (value: string) => {
    const preset = zoomPresets.find((p) => p.label === value);
    if (preset) {
      handlePresetZoom(preset);
    }
  };

  const currentQualityLabel = QUALITY_PRESETS.find((p) => p.value === previewQuality)?.label ?? 'Full';

  return (
    <div className="flex items-center gap-1">
      <Select
        value={currentQualityLabel}
        onValueChange={(value) => {
          const preset = QUALITY_PRESETS.find((p) => p.label === value);
          if (preset) setPreviewQuality(preset.value);
        }}
      >
        <SelectTrigger className="w-[72px] h-7 text-xs" data-tooltip="Preview Quality">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUALITY_PRESETS.map((preset) => (
            <SelectItem key={preset.label} value={preset.label} className="text-xs">
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={currentLabel} onValueChange={handleValueChange}>
        <SelectTrigger className="w-20 h-7 text-xs" data-tooltip="Preview Zoom">
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
    </div>
  );
}
