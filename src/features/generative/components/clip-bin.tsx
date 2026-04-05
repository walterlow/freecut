import { useCallback, memo } from 'react';
import { Film, Trash2 } from 'lucide-react';

export interface ClipBinEntry {
  id: string;
  blob: Blob;
  thumbnailUrl: string;
  durationMs: number;
  createdAt: number;
}

interface ClipBinProps {
  clips: ClipBinEntry[];
  onRemoveClip?: (id: string) => void;
  onDragClip?: (clip: ClipBinEntry) => void;
}

/**
 * Clip Bin: thumbnail grid of AI-generated clips.
 * Clips are auto-saved from AI renders and can be dragged to the timeline.
 */
export const ClipBin = memo(function ClipBin({ clips, onRemoveClip, onDragClip }: ClipBinProps) {
  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
        <Film className="h-8 w-8" />
        <span className="text-xs">No clips yet. Render or record to add clips.</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 p-1.5">
      {clips.map((clip) => (
        <ClipThumbnail
          key={clip.id}
          clip={clip}
          onRemove={onRemoveClip}
          onDragStart={onDragClip}
        />
      ))}
    </div>
  );
});

interface ClipThumbnailProps {
  clip: ClipBinEntry;
  onRemove?: (id: string) => void;
  onDragStart?: (clip: ClipBinEntry) => void;
}

const ClipThumbnail = memo(function ClipThumbnail({
  clip,
  onRemove,
  onDragStart,
}: ClipThumbnailProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-generative-clip', clip.id);
      e.dataTransfer.effectAllowed = 'copy';
      onDragStart?.(clip);
    },
    [clip, onDragStart],
  );

  const durationLabel =
    clip.durationMs >= 1000
      ? `${(clip.durationMs / 1000).toFixed(1)}s`
      : `${clip.durationMs}ms`;

  return (
    <div
      className="group relative aspect-video cursor-grab overflow-hidden rounded-md border border-border bg-muted/30 transition-colors hover:border-primary/50 active:cursor-grabbing"
      draggable
      onDragStart={handleDragStart}
    >
      <img
        src={clip.thumbnailUrl}
        alt="AI clip"
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5">
        <span className="text-[10px] text-white">{durationLabel}</span>
      </div>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(clip.id);
          }}
          className="absolute right-0.5 top-0.5 rounded-full bg-destructive p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Trash2 className="h-2.5 w-2.5 text-destructive-foreground" />
        </button>
      )}
    </div>
  );
});
