import { useRef, useEffect, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Film,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Scissors,
  Gauge,
  X,
  MousePointer2,
  Undo2,
  Redo2,
  Flag,
  FlagOff,
  LineChart,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import {
  ZOOM_FRICTION,
  ZOOM_MIN_VELOCITY,
  ZOOM_MIN,
  ZOOM_MAX,
} from '../constants';

interface TimelineHeaderProps {
  onZoomChange?: (newZoom: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomToFit?: () => void;
  /** Whether the keyframe graph panel is open */
  isGraphPanelOpen?: boolean;
  /** Callback to toggle the graph panel */
  onToggleGraphPanel?: () => void;
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
export const TimelineHeader = memo(function TimelineHeader({
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
  isGraphPanelOpen,
  onToggleGraphPanel,
}: TimelineHeaderProps) {
  const { zoomLevel, zoomIn, zoomOut, setZoom } = useTimelineZoom();
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const clearInOutPoints = useTimelineStore((s) => s.clearInOutPoints);
  const addMarker = useTimelineStore((s) => s.addMarker);
  // Only subscribe to marker count for disabled state - avoids re-render on marker changes
  const hasMarkers = useTimelineStore((s) => s.markers.length > 0);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const clearAllMarkers = useTimelineStore((s) => s.clearAllMarkers);
  // NOTE: Don't subscribe to currentFrame - only needed in click handlers
  // Read from store directly when needed to avoid re-renders every frame
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);


  // Momentum state for zoom slider
  const zoomVelocityRef = useRef(0);
  const lastZoomValueRef = useRef(zoomLevel);
  const lastZoomTimeRef = useRef(0);
  const momentumIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  // Apply zoom with bounds checking
  const applyZoom = useCallback((newZoom: number) => {
    const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    if (onZoomChange) {
      onZoomChange(clampedZoom);
    } else {
      setZoom(clampedZoom);
    }
    return clampedZoom;
  }, [onZoomChange, setZoom]);

  // Momentum loop for zoom slider
  const startZoomMomentum = useCallback(() => {
    if (momentumIdRef.current !== null) {
      cancelAnimationFrame(momentumIdRef.current);
    }

    const momentumLoop = () => {
      if (Math.abs(zoomVelocityRef.current) > ZOOM_MIN_VELOCITY) {
        const newZoom = zoomLevelRef.current + zoomVelocityRef.current;
        const clampedZoom = applyZoom(newZoom);

        // Stop momentum if we hit bounds
        if (clampedZoom <= ZOOM_MIN || clampedZoom >= ZOOM_MAX) {
          zoomVelocityRef.current = 0;
          momentumIdRef.current = null;
          return;
        }

        zoomVelocityRef.current *= ZOOM_FRICTION;
        momentumIdRef.current = requestAnimationFrame(momentumLoop);
      } else {
        zoomVelocityRef.current = 0;
        momentumIdRef.current = null;
      }
    };

    momentumIdRef.current = requestAnimationFrame(momentumLoop);
  }, [applyZoom]);

  // Convert between linear slider position (0-1) and logarithmic zoom level
  // This gives finer control at low zoom levels
  const sliderToZoom = useCallback((sliderValue: number) => {
    // Map 0-1 to log scale: ZOOM_MIN to ZOOM_MAX
    // Using exponential: zoom = min * (max/min)^slider
    return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, sliderValue);
  }, []);

  const zoomToSlider = useCallback((zoom: number) => {
    // Inverse of sliderToZoom: slider = log(zoom/min) / log(max/min)
    return Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
  }, []);

  // Handle slider value change (while dragging)
  const handleSliderChange = useCallback((values: number[]) => {
    const sliderValue = values[0] ?? 0.5;
    const newZoom = sliderToZoom(sliderValue);
    const now = performance.now();
    const timeDelta = now - lastZoomTimeRef.current;

    // Calculate velocity based on change over time (in zoom space, not slider space)
    if (timeDelta > 0 && timeDelta < 100) {
      const valueDelta = newZoom - lastZoomValueRef.current;
      zoomVelocityRef.current = valueDelta / timeDelta * 16; // Normalize to ~60fps
    }

    lastZoomValueRef.current = newZoom;
    lastZoomTimeRef.current = now;
    isDraggingRef.current = true;

    applyZoom(newZoom);
  }, [applyZoom, sliderToZoom]);

  // Handle slider release - start momentum
  const handleSliderCommit = useCallback(() => {
    isDraggingRef.current = false;
    // Only start momentum if there's meaningful velocity
    if (Math.abs(zoomVelocityRef.current) > ZOOM_MIN_VELOCITY) {
      startZoomMomentum();
    }
    // Blur slider to release focus for keyboard shortcuts (play/pause)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [startZoomMomentum]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (momentumIdRef.current !== null) {
        cancelAnimationFrame(momentumIdRef.current);
      }
    };
  }, []);

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
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${
              activeTool === 'select' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }`}
            onClick={() => setActiveTool('select')}
            data-tooltip="Select Tool (V)"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${
              activeTool === 'razor' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }`}
            onClick={() => setActiveTool(activeTool === 'razor' ? 'select' : 'razor')}
            data-tooltip="Razor Tool (C)"
          >
            <Scissors className="w-3.5 h-3.5 -rotate-90" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${
              activeTool === 'rate-stretch' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }`}
            onClick={() => setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch')}
            data-tooltip="Rate Stretch Tool (R)"
          >
            <Gauge className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleUndo}
            data-tooltip="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRedo}
            data-tooltip="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* In/Out Points */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setInPoint(usePlaybackStore.getState().currentFrame)}
            data-tooltip="Set In Point (I)"
          >
            <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-in)' }}>[</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOutPoint(usePlaybackStore.getState().currentFrame)}
            data-tooltip="Set Out Point (O)"
          >
            <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-out)' }}>]</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clearInOutPoints}
            disabled={inPoint === null && outPoint === null}
            data-tooltip="Clear In/Out Points"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Markers */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => addMarker(usePlaybackStore.getState().currentFrame)}
            data-tooltip="Add Marker (M)"
          >
            <Flag className="w-3.5 h-3.5" style={{ color: 'var(--color-timeline-marker)' }} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (selectedMarkerId) {
                removeMarker(selectedMarkerId);
                clearSelection();
              }
            }}
            disabled={!selectedMarkerId}
            data-tooltip="Remove Selected Marker"
          >
            <FlagOff className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clearAllMarkers}
            disabled={!hasMarkers}
            data-tooltip="Clear All Markers"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Snap Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${
            snapEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
          onClick={toggleSnap}
          data-tooltip={snapEnabled ? 'Snap Enabled' : 'Snap Disabled'}
        >
          <Magnet className="w-3.5 h-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Keyframe Graph Panel Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${
            isGraphPanelOpen ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
          onClick={onToggleGraphPanel}
          data-tooltip={isGraphPanelOpen ? 'Hide Keyframe Graph' : 'Show Keyframe Graph'}
        >
          <LineChart className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Right: Zoom Controls */}
      <div className="flex items-center gap-2">
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
          data-tooltip="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>

        <Slider
          value={[zoomToSlider(zoomLevel)]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          min={0}
          max={1}
          step={0.005}
          className="w-24"
        />

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
          data-tooltip="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onZoomToFit}
          data-tooltip="Zoom to Fit (Z)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>

        <span className="text-xs text-muted-foreground font-mono w-12 text-right">
          {Math.round(zoomLevel * 100)}%
        </span>
      </div>
    </div>
  );
});
