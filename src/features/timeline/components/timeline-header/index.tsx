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
  Magnet,
  Scissors,
  Gauge,
  CornerRightDown,
  CornerRightUp,
  X,
  MousePointer2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useTimelineZoom } from '../../hooks/use-timeline-zoom';
import { useTimelineStore } from '../../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';

export interface TimelineHeaderProps {
  onZoomChange?: (newZoom: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

/**
 * Timeline Toolbar Component
 *
 * Unified toolbar for timeline controls:
 * - Select/Razor tools
 * - Undo/Redo
 * - In/Out points, Snap toggle
 * - Zoom controls
 */
export function TimelineHeader({ onZoomChange, onZoomIn, onZoomOut }: TimelineHeaderProps) {
  const { zoomLevel, zoomIn, zoomOut, setZoom } = useTimelineZoom();
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const clearInOutPoints = useTimelineStore((s) => s.clearInOutPoints);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);

  const handleUndo = () => {
    useTimelineStore.temporal.getState().undo();
  };

  const handleRedo = () => {
    useTimelineStore.temporal.getState().redo();
  };

  return (
    <div className="h-11 flex items-center justify-between px-4 border-b border-border">
      {/* Left: Title & Tools */}
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
          <Film className="w-3 h-3" />
          Timeline
        </h2>

        {/* Select/Razor Tools */}
        <div className="flex items-center gap-1 px-1.5 py-1 bg-secondary/50 rounded-md border border-border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${
                  activeTool === 'select' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                }`}
                onClick={() => setActiveTool('select')}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Select Tool (V)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${
                  activeTool === 'razor' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                }`}
                onClick={() => setActiveTool(activeTool === 'razor' ? 'select' : 'razor')}
              >
                <Scissors className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Razor Tool (C)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${
                  activeTool === 'rate-stretch' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                }`}
                onClick={() => setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch')}
              >
                <Gauge className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rate Stretch Tool (R)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleUndo}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleRedo}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* In/Out Points */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setInPoint(currentFrame)}
              >
                <CornerRightDown className="w-3.5 h-3.5" style={{ color: 'oklch(0.65 0.18 142)' }} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set In Point (I)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOutPoint(currentFrame)}
              >
                <CornerRightUp className="w-3.5 h-3.5" style={{ color: 'oklch(0.61 0.22 29)' }} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set Out Point (O)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearInOutPoints}
                disabled={inPoint === null && outPoint === null}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear In/Out Points</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Snap Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${
                snapEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
              }`}
              onClick={toggleSnap}
            >
              <Magnet className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {snapEnabled ? 'Snap Enabled' : 'Snap Disabled'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Right: Zoom Controls */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (onZoomOut) {
                  onZoomOut();
                } else {
                  zoomOut();
                }
              }}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <Slider
          value={[zoomLevel]}
          onValueChange={(values) => {
            const newZoom = values[0] ?? 1;
            if (onZoomChange) {
              onZoomChange(newZoom);
            } else {
              setZoom(newZoom);
            }
          }}
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
              onClick={() => {
                if (onZoomIn) {
                  onZoomIn();
                } else {
                  zoomIn();
                }
              }}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground font-mono w-12 text-right">
          {Math.round(zoomLevel * 100)}%
        </span>
      </div>
    </div>
  );
}
