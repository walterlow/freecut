import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import {
  Film,
  ZoomIn,
  ZoomOut,
  Grid3x3,
} from 'lucide-react';
import { useTimelineZoom } from '../../hooks/use-timeline-zoom';
import { useTimelineStore } from '../../stores/timeline-store';

export interface TimelineHeaderProps {}

/**
 * Timeline Header Component
 *
 * Contains timeline controls:
 * - Title and icon
 * - Zoom in/out buttons with slider
 * - Snap to grid toggle
 * - Additional timeline tools
 */
export function TimelineHeader(_props: TimelineHeaderProps) {
  const { zoomLevel, zoomIn, zoomOut, setZoom } = useTimelineZoom();
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);

  return (
    <div className="h-11 flex items-center justify-between px-4 border-b border-border">
      <div className="flex items-center gap-4">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
          <Film className="w-3 h-3" />
          Timeline
        </h2>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={zoomOut}
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>

          <Slider
            value={[zoomLevel]}
            onValueChange={(values) => setZoom(values[0] ?? 1)}
            min={0.01}
            max={2}
            step={0.01}
            className="w-24"
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={zoomIn}
              >
                <ZoomIn className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>

          <span className="text-xs text-muted-foreground font-mono w-12 text-right">
            {Math.round(zoomLevel * 100)}%
          </span>
        </div>
      </div>

      {/* Timeline Tools */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={snapEnabled ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={toggleSnap}
            >
              <Grid3x3 className="w-3 h-3 mr-1.5" />
              Snap
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {snapEnabled ? 'Snap Enabled' : 'Snap Disabled'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
