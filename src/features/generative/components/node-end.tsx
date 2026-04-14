import { useCallback, useRef, useState, memo } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { useGenerativeStore } from '../stores/generative-store';
import { ImageGenDialog } from './image-gen-dialog';
import type { ImageSource } from '../types';

export const NodeEnd = memo(function NodeEnd() {
  const endImage = useGenerativeStore((s) => s.endImage);
  const setEndImage = useGenerativeStore((s) => s.setEndImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (endImage?.type === 'file') {
        URL.revokeObjectURL(endImage.objectUrl);
      }
      const objectUrl = URL.createObjectURL(file);
      setEndImage({ type: 'file', blob: file, objectUrl });
    },
    [setEndImage, endImage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleClear = useCallback(() => {
    if (endImage?.type === 'file') {
      URL.revokeObjectURL(endImage.objectUrl);
    }
    setEndImage(null);
  }, [setEndImage, endImage]);

  const handleImageGenerated = useCallback(
    (source: ImageSource) => {
      if (endImage?.type === 'file') {
        URL.revokeObjectURL(endImage.objectUrl);
      }
      setEndImage(source);
    },
    [setEndImage, endImage],
  );

  const previewUrl =
    endImage?.type === 'file'
      ? endImage.objectUrl
      : endImage?.type === 'generated'
        ? endImage.url
        : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">End Image (Optional)</span>
      <div
        className={`relative flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed transition-colors sm:h-40 sm:w-40 ${
          dragOver
            ? 'border-primary bg-primary/10'
            : 'border-border bg-muted/30 hover:border-primary/50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !endImage && inputRef.current?.click()}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt="End"
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
            {endImage?.type === 'generated' && (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                AI
              </span>
            )}
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
      <ImageGenDialog node="end" onImageGenerated={handleImageGenerated} />
    </div>
  );
});
