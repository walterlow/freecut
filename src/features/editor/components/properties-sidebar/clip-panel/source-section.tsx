import { useMemo } from 'react';
import { FileVideo, FileAudio, FileImage, Type, Square, Layers } from 'lucide-react';
import type { TimelineItem } from '@/types/timeline';
import { PropertySection, PropertyRow } from '../components';

interface SourceSectionProps {
  items: TimelineItem[];
  fps: number;
}

const typeIcons = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  text: Type,
  shape: Square,
  adjustment: Layers,
};

/**
 * Format duration in frames to MM:SS.FF
 */
function formatDuration(frames: number, fps: number): string {
  const totalSeconds = frames / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const remainingFrames = Math.floor(frames % fps);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainingFrames).padStart(2, '0')}`;
}

/**
 * Source section - displays read-only file information.
 */
export function SourceSection({ items, fps }: SourceSectionProps) {
  const isMultiSelection = items.length > 1;

  // Get common type if all items are the same type
  const commonType = useMemo(() => {
    if (items.length === 0) return null;
    const firstType = items[0]!.type; // Safe: length checked above
    return items.every((item) => item.type === firstType) ? firstType : null;
  }, [items]);

  const Icon = commonType ? typeIcons[commonType] : FileVideo;

  // For single selection, show detailed info
  if (!isMultiSelection && items.length === 1) {
    const item = items[0]!; // Safe: length === 1 checked above
    const duration = item.sourceDuration ?? item.durationInFrames;

    return (
      <PropertySection title="Source" icon={Icon} defaultOpen={true}>
        <PropertyRow label="File">
          <span className="text-xs text-muted-foreground truncate" title={item.label}>
            {item.label}
          </span>
        </PropertyRow>

        <PropertyRow label="Duration">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(duration, fps)}
          </span>
        </PropertyRow>

        {item.type === 'video' || item.type === 'audio' || (item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')) ? (
          <PropertyRow label="Speed">
            <span className="text-xs text-muted-foreground tabular-nums">
              {((item as { speed?: number }).speed ?? 1).toFixed(2)}x
            </span>
          </PropertyRow>
        ) : null}
      </PropertySection>
    );
  }

  // For multi-selection, show summary
  return (
    <PropertySection title="Source" icon={Icon} defaultOpen={true}>
      <PropertyRow label="Selection">
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length} clips selected
        </span>
      </PropertyRow>

      {commonType && (
        <PropertyRow label="Type">
          <span className="text-xs text-muted-foreground capitalize">
            {commonType}
          </span>
        </PropertyRow>
      )}
    </PropertySection>
  );
}
