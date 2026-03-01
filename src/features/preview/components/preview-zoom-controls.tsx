import { useCallback, useRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreviewZoom } from '../hooks/use-preview-zoom';
import { usePlaybackStore } from '@/shared/state/playback';
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
  const qualityTriggerRef = useRef<HTMLButtonElement>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);

  const currentLabel = zoom === -1
    ? 'Auto'
    : zoomPresets.find((p) => p.value === zoom)?.label || `${Math.round(zoom * 100)}%`;

  const blurQualityTrigger = useCallback(() => {
    qualityTriggerRef.current?.blur();
  }, []);

  const handleSelectTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    // Space is reserved for global play/pause; prevent SelectTrigger from opening.
    event.preventDefault();
  }, []);

  const blurZoomTrigger = useCallback(() => {
    zoomTriggerRef.current?.blur();
  }, []);

  const handleValueChange = (value: string) => {
    const preset = zoomPresets.find((p) => p.label === value);
    if (preset) {
      handlePresetZoom(preset);
    }
    requestAnimationFrame(blurZoomTrigger);
  };

  const currentQualityLabel = QUALITY_PRESETS.find((p) => p.value === previewQuality)?.label ?? 'Full';

  return (
    <div className="flex items-center gap-1">
      <Select
        value={currentQualityLabel}
        onOpenChange={(open) => {
          if (!open) {
            requestAnimationFrame(blurQualityTrigger);
          }
        }}
        onValueChange={(value) => {
          const preset = QUALITY_PRESETS.find((p) => p.label === value);
          if (preset) setPreviewQuality(preset.value);
          requestAnimationFrame(blurQualityTrigger);
        }}
      >
        <SelectTrigger
          ref={qualityTriggerRef}
          className="w-[72px] h-7 text-xs"
          data-tooltip="Preview Quality"
          onKeyDown={handleSelectTriggerKeyDown}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(blurQualityTrigger);
          }}
        >
          {QUALITY_PRESETS.map((preset) => (
            <SelectItem key={preset.label} value={preset.label} className="text-xs">
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={currentLabel}
        onOpenChange={(open) => {
          if (!open) {
            requestAnimationFrame(blurZoomTrigger);
          }
        }}
        onValueChange={handleValueChange}
      >
        <SelectTrigger
          ref={zoomTriggerRef}
          className="w-20 h-7 text-xs"
          data-tooltip="Preview Zoom"
          onKeyDown={handleSelectTriggerKeyDown}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(blurZoomTrigger);
          }}
        >
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
