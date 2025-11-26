import { useState, useEffect, useRef } from 'react';
import { Separator } from '@/components/ui/separator';
import {
  VideoPreview,
  PlaybackControls,
  TimecodeDisplay,
  PreviewZoomControls,
} from '@/features/preview';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';

interface PreviewAreaProps {
  project: {
    width: number;
    height: number;
    fps: number;
  };
}

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
export function PreviewArea({ project }: PreviewAreaProps) {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Calculate total frames from timeline items
  const items = useTimelineStore((s) => s.items);
  const totalFrames = items.length > 0
    ? Math.max(...items.map(item => item.from + item.durationInFrames))
    : project.fps * 10; // Default 10 seconds if no items

  // Measure preview container size for zoom calculations
  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      // Account for padding (p-6 = 24px on each side)
      setContainerSize({
        width: rect.width - 48,
        height: rect.height - 48,
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Video Preview Canvas */}
      <div ref={previewContainerRef} className="flex-1 min-h-0">
        <VideoPreview project={project} containerSize={containerSize} />
      </div>

      {/* Playback Controls */}
      <div className="h-16 border-t border-border panel-header flex items-center justify-center px-6 flex-shrink-0 relative">
        {/* Left: Timecode Display */}
        <div className="absolute left-6">
          <TimecodeDisplay fps={project.fps} totalFrames={totalFrames} />
        </div>

        {/* Center: Playback Controls */}
        <PlaybackControls totalFrames={totalFrames} fps={project.fps} />

        {/* Right: Zoom Controls */}
        <div className="absolute right-6">
          <PreviewZoomControls
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            projectWidth={project.width}
            projectHeight={project.height}
          />
        </div>
      </div>
    </div>
  );
}
