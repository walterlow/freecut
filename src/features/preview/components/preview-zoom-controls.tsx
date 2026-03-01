import { useCallback, useRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreviewZoom } from '../hooks/use-preview-zoom';

export function PreviewZoomControls() {
  const { zoom, zoomPresets, handlePresetZoom } = usePreviewZoom();
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);

  const currentLabel = zoom === -1
    ? 'Auto'
    : zoomPresets.find((p) => p.value === zoom)?.label || `${Math.round(zoom * 100)}%`;

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

  return (
    <div className="flex items-center gap-1">
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
