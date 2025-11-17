import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Maximize2, Play } from 'lucide-react';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';

interface VideoPreviewProps {
  project: {
    width: number;
    height: number;
  };
}

/**
 * Video Preview Component
 *
 * Displays the video canvas with:
 * - Grid overlay
 * - Corner rulers
 * - Frame counter
 * - Fullscreen toggle
 * - Aspect ratio preservation
 *
 * Note: Currently displays a placeholder canvas. Actual video rendering
 * will be implemented with Remotion Player integration.
 */
export function VideoPreview({ project }: VideoPreviewProps) {
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const items = useTimelineStore((s) => s.items);

  // Calculate total frames from the maximum item end time
  const totalFrames = items.length > 0
    ? Math.max(...items.map((item) => item.from + item.durationInFrames))
    : 900; // Default to 900 frames (30s at 30fps) if no items

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6 bg-gradient-to-br from-background to-secondary/20">
      <div
        className="relative w-full max-w-6xl max-h-full"
        style={{
          aspectRatio: `${project.width || 16}/${project.height || 9}`,
        }}
      >
        {/* Video Preview Canvas */}
        <div className="w-full h-full rounded-lg overflow-hidden bg-black border-2 border-border shadow-2xl">
          {/* Placeholder */}
          <div className="w-full h-full bg-gradient-to-br from-secondary/40 to-background/60 flex items-center justify-center relative">
            {/* Grid overlay */}
            <div className="absolute inset-0 opacity-[0.03]">
              <div
                className="w-full h-full"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, oklch(0.95 0 0) 1px, transparent 1px),
                    linear-gradient(to bottom, oklch(0.95 0 0) 1px, transparent 1px)
                  `,
                  backgroundSize: '20px 20px',
                }}
              />
            </div>

            <div className="text-center relative z-10">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
                <Play className="w-10 h-10 text-primary ml-1" />
              </div>
              <p className="text-sm text-muted-foreground font-mono">
                Preview Canvas
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {project.width}×{project.height}
              </p>
            </div>

            {/* Corner rulers for professional feel */}
            <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-primary/20" />
            <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-primary/20" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-primary/20" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-primary/20" />
          </div>
        </div>

        {/* Frame Counter */}
        <div className="absolute -bottom-7 right-0 font-mono text-xs text-primary tabular-nums flex items-center gap-2">
          <span className="text-muted-foreground">Frame:</span>
          <span className="font-medium">
            {String(currentFrame).padStart(5, '0')} /{' '}
            {String(totalFrames).padStart(5, '0')}
          </span>
        </div>

        {/* Fullscreen toggle - handler pending implementation */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-3 -right-3 h-8 w-8 rounded-full shadow-lg"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fullscreen Preview</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
