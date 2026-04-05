import { useCallback, useRef, useState, memo } from 'react';
import { Button } from '@/components/ui/button';
import { ImagePlus, Camera, X } from 'lucide-react';
import { useGenerativeStore } from '../stores/generative-store';

/**
 * Node A: Start Image drop-zone.
 * Users can drag an image, paste from clipboard, or capture from webcam.
 */
export const NodeStart = memo(function NodeStart() {
  const startImage = useGenerativeStore((s) => s.startImage);
  const setStartImage = useGenerativeStore((s) => s.setStartImage);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      setStartImage(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [setStartImage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleClear = useCallback(() => {
    setStartImage(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }, [setStartImage, previewUrl]);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Start Image</span>
      <div
        className="relative flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => !startImage && inputRef.current?.click()}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt="Start"
              className="h-full w-full rounded-lg object-cover"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-sm"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImagePlus className="h-8 w-8" />
            <span className="text-xs">Drop or click</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled>
        <Camera className="mr-1 h-3 w-3" />
        Capture
      </Button>
    </div>
  );
});
