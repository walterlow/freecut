import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { VideoPreview } from '@/features/preview/components/video-preview';
import { PlaybackControls } from '@/features/preview/components/playback-controls';
import { TimecodeDisplay } from '@/features/preview/components/timecode-display';
import { PreviewZoomControls } from '@/features/preview/components/preview-zoom-controls';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useProjectStore } from '@/features/projects/stores/project-store';

interface PreviewAreaProps {
  project: {
    width: number;
    height: number;
    fps: number;
  };
}

const PREVIEW_PADDING_PX = 48;
const DEFAULT_EMPTY_TIMELINE_SECONDS = 10;

/**
 * Preview Area Component
 *
 * Modular composition of preview-related components:
 * - VideoPreview: Canvas with grid, rulers, frame counter
 * - PlaybackControls: Transport controls with React 19 patterns
 * - TimecodeDisplay: Current time display
 * - PreviewZoomControls: Fit-to-panel zoom control
 *
 * Uses granular Zustand selectors in child components
 */
export const PreviewArea = memo(function PreviewArea({ project }: PreviewAreaProps) {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Read current project from store for live updates (e.g., dimension swaps)
  // Use granular selectors to avoid re-renders when unrelated properties change
  const projectWidth = useProjectStore((s) => s.currentProject?.metadata.width);
  const projectHeight = useProjectStore((s) => s.currentProject?.metadata.height);
  const projectFps = useProjectStore((s) => s.currentProject?.metadata.fps);
  const projectBgColor = useProjectStore((s) => s.currentProject?.metadata.backgroundColor);

  const width = projectWidth ?? project.width;
  const height = projectHeight ?? project.height;
  const fps = projectFps ?? project.fps;
  const backgroundColor = projectBgColor ?? '#000000';

  // Derive timeline end frame directly from store state to avoid recreating selector functions.
  const timelineEndFrame = useTimelineStore((s) => {
    if (s.items.length === 0) return null;
    let maxFrame = 0;
    for (const item of s.items) {
      const itemEnd = item.from + item.durationInFrames;
      if (itemEnd > maxFrame) {
        maxFrame = itemEnd;
      }
    }
    return maxFrame;
  });

  const totalFrames = timelineEndFrame ?? fps * DEFAULT_EMPTY_TIMELINE_SECONDS;

  // Measure preview container size for zoom calculations
  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextWidth = Math.max(0, Math.floor(rect.width - PREVIEW_PADDING_PX));
      const nextHeight = Math.max(0, Math.floor(rect.height - PREVIEW_PADDING_PX));

      // Bail out when dimensions are unchanged to avoid redundant re-renders.
      setContainerSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    // Initial measurement
    updateSize();

    // Use ResizeObserver to detect panel resizing
    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Build project object with live values from store
  // Memoize to prevent VideoPreview re-renders when reference changes
  const liveProject = useMemo(
    () => ({ width, height, fps, backgroundColor }),
    [width, height, fps, backgroundColor]
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Video Preview Canvas - overflow-hidden clips gizmos at container boundary */}
      <div ref={previewContainerRef} className="flex-1 min-h-0 relative overflow-hidden">
        <VideoPreview project={liveProject} containerSize={containerSize} />
      </div>

      {/* Playback Controls */}
      <div className="h-16 border-t border-border panel-header flex items-center justify-center px-6 flex-shrink-0 relative">
        {/* Left: Timecode Display */}
        <div className="absolute left-6">
          <TimecodeDisplay fps={fps} totalFrames={totalFrames} />
        </div>

        {/* Center: Playback Controls */}
        <PlaybackControls totalFrames={totalFrames} fps={fps} />

        {/* Right: Zoom Controls */}
        <div className="absolute right-6">
          <PreviewZoomControls />
        </div>
      </div>
    </div>
  );
});
