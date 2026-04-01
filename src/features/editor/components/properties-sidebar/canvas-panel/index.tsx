import { useCallback, useState, useRef, useEffect, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeftRight, RotateCcw, LayoutDashboard, Clock } from 'lucide-react';
import { useProjectStore } from '@/features/editor/deps/projects';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore } from '@/features/editor/deps/preview';
import { HexColorPicker } from 'react-colorful';
import { toast } from 'sonner';
import {
  PropertySection,
  PropertyRow,
  LinkedDimensions,
} from '../components';
import { commitProjectMetadataChange } from '@/features/editor/utils/project-metadata-history';

/**
 * Isolated color picker using react-colorful.
 * Local state for instant preview, commits on mouse release.
 * Uses gizmo store for live canvas preview during drag.
 * Click outside to close.
 */
const ColorPicker = memo(function ColorPicker({
  initialColor,
  onColorChange,
}: {
  initialColor: string;
  onColorChange: (color: string) => void;
}) {
  const [color, setColor] = useState(initialColor);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const setCanvasBackgroundPreview = useGizmoStore((s) => s.setCanvasBackgroundPreview);
  const clearCanvasBackgroundPreview = useGizmoStore((s) => s.clearCanvasBackgroundPreview);

  // Sync local state when initialColor changes from outside (e.g., reset button)
  useEffect(() => {
    setColor(initialColor);
  }, [initialColor]);

  const handleColorChange = useCallback((newColor: string) => {
    setColor(newColor);
    // Live preview on canvas
    setCanvasBackgroundPreview(newColor);
  }, [setCanvasBackgroundPreview]);

  const handleCommit = useCallback(() => {
    // Clear preview and commit to store
    clearCanvasBackgroundPreview();
    onColorChange(color);
  }, [color, onColorChange, clearCanvasBackgroundPreview]);

  const handleClose = useCallback(() => {
    handleCommit();
    setIsOpen(false);
  }, [handleCommit]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleClose]);

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full"
      >
        <div
          className="w-6 h-6 rounded border border-border flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-mono text-muted-foreground uppercase">
          {color}
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-8 left-0 z-50 p-2 bg-popover border border-border rounded-lg shadow-lg">
          <HexColorPicker color={color} onChange={handleColorChange} />
        </div>
      )}
    </div>
  );
});

/**
 * Canvas properties panel - shown when no clip is selected.
 * Displays and allows editing of canvas dimensions and shows project duration.
 */
export const CanvasPanel = memo(function CanvasPanel() {
  // Granular selectors
  const currentProject = useProjectStore((s) => s.currentProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const fps = useTimelineStore((s) => s.fps);
  const markDirty = useTimelineStore((s) => s.markDirty);

  // Derived selector: only returns the computed duration, not the full items array
  // This prevents re-renders when items change but duration stays the same
  const timelineDuration = useTimelineStore((s) =>
    s.items.length === 0 ? 0 : Math.max(...s.items.map((item) => item.from + item.durationInFrames))
  );


  // All handlers must be defined before any early returns (Rules of Hooks)
  const width = currentProject?.metadata.width ?? 1920;
  const height = currentProject?.metadata.height ?? 1080;
  const storedBackgroundColor = currentProject?.metadata.backgroundColor ?? '#000000';

  const applyProjectMetadataChange = useCallback(async (
    updates: Parameters<typeof commitProjectMetadataChange>[0]['updates'],
    command: Parameters<typeof commitProjectMetadataChange>[0]['command']
  ) => {
    if (!currentProject) {
      return;
    }

    try {
      await commitProjectMetadataChange({
        project: currentProject,
        updates,
        command,
        updateProject,
        markDirty,
      });
    } catch (error) {
      toast.error('Failed to update canvas settings', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }, [currentProject, markDirty, updateProject]);


  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const normalizedWidth = Math.round(newWidth / 2) * 2;
      void applyProjectMetadataChange(
        { width: normalizedWidth },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width'] } }
      );
    },
    [applyProjectMetadataChange]
  );

  const handleHeightChange = useCallback(
    (newHeight: number) => {
      const normalizedHeight = Math.round(newHeight / 2) * 2;
      void applyProjectMetadataChange(
        { height: normalizedHeight },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['height'] } }
      );
    },
    [applyProjectMetadataChange]
  );

  const handleSwapDimensions = useCallback(() => {
    void applyProjectMetadataChange(
      { width: height, height: width },
      { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width', 'height'], operation: 'swap' } }
    );
  }, [applyProjectMetadataChange, height, width]);

  const handleResetDimensions = useCallback(() => {
    void applyProjectMetadataChange(
      { width: 1920, height: 1080 },
      { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width', 'height'], operation: 'reset' } }
    );
  }, [applyProjectMetadataChange]);

  // Commit background color to store on release
  const handleBackgroundColorChange = useCallback(
    (color: string) => {
      void applyProjectMetadataChange(
        { backgroundColor: color },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['backgroundColor'] } }
      );
    },
    [applyProjectMetadataChange]
  );

  // Reset background color to black
  const handleResetBackgroundColor = useCallback(() => {
    if (storedBackgroundColor === '#000000') return; // Already default
    void applyProjectMetadataChange(
      { backgroundColor: '#000000' },
      { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['backgroundColor'], operation: 'reset' } }
    );
  }, [applyProjectMetadataChange, storedBackgroundColor]);

  // Format duration as MM:SS.FF
  const formatDuration = (frames: number): string => {
    const totalSeconds = frames / fps;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const remainingFrames = frames % fps;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainingFrames).padStart(2, '0')}`;
  };

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-xs text-muted-foreground">No project loaded</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Canvas Section */}
      <PropertySection title="Canvas" icon={LayoutDashboard} defaultOpen={true}>
        <LinkedDimensions
          width={width}
          height={height}
          aspectLocked={false}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
          onAspectLockToggle={() => {}}
          minWidth={320}
          minHeight={240}
          maxWidth={7680}
          maxHeight={4320}
          step={2}
        />

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={handleSwapDimensions}
          >
            <ArrowLeftRight className="w-3 h-3 mr-1.5" />
            Swap
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={handleResetDimensions}
          >
            <RotateCcw className="w-3 h-3 mr-1.5" />
            Reset
          </Button>
        </div>

        {/* Background Color */}
        <PropertyRow label="Background">
          <div className="flex items-center gap-1 w-full">
            <ColorPicker
              initialColor={storedBackgroundColor}
              onColorChange={handleBackgroundColorChange}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetBackgroundColor}
              title="Reset to black"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>

      <Separator />

      {/* Duration Section */}
      <PropertySection title="Duration" icon={Clock} defaultOpen={true}>
        <PropertyRow label="Duration">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(timelineDuration)}
          </span>
        </PropertyRow>

        <PropertyRow label="Frame Rate">
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentProject.metadata.fps} fps
          </span>
        </PropertyRow>

        <PropertyRow label="Total Frames">
          <span className="text-xs text-muted-foreground tabular-nums">
            {timelineDuration} fr
          </span>
        </PropertyRow>
      </PropertySection>
    </div>
  );
});
