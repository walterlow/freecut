import { useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { usePreviewZoom } from '../hooks/use-preview-zoom';

const BUTTON_STYLE = {
  height: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
  width: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
};

export function PreviewZoomControls() {
  const { zoom, zoomPresets, handlePresetZoom } = usePreviewZoom();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentLabel = zoom === -1
    ? 'Auto'
    : zoomPresets.find((p) => p.value === zoom)?.label || `${Math.round(zoom * 100)}%`;

  const blurTrigger = useCallback(() => {
    triggerRef.current?.blur();
  }, []);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) requestAnimationFrame(blurTrigger);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          style={BUTTON_STYLE}
          data-tooltip={`Zoom: ${currentLabel}`}
          aria-label={`Preview zoom: ${currentLabel}`}
          onKeyDown={(e) => {
            // Space is reserved for global play/pause
            if (e.key === ' ' || e.code === 'Space') e.preventDefault();
          }}
        >
          <Search className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(blurTrigger);
        }}
      >
        {zoomPresets.map((preset) => (
          <DropdownMenuItem
            key={preset.label}
            className="text-xs"
            onSelect={() => handlePresetZoom(preset)}
          >
            <span className={zoom === preset.value || (preset.value === 'fit' && zoom === -1) ? 'font-semibold' : ''}>
              {preset.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
