import { useCallback, useRef, useState, memo } from 'react';
import { Button } from '@/components/ui/button';
import { ImagePlus, Camera, X } from 'lucide-react';
import { useGenerativeStore } from '../stores/generative-store';
import { usePlaybackStore } from '../deps/playback-contract';
import { ImageGenDialog } from './image-gen-dialog';
import type { ImageSource } from '../types';

/**
 * Node A: Start Image drop-zone.
 * Users can drag an image, paste from clipboard, capture from the preview canvas,
 * or generate one with AI (Nanobanana 2).
 */
export const NodeStart = memo(function NodeStart() {
  const startImage = useGenerativeStore((s) => s.startImage);
  const setStartImage = useGenerativeStore((s) => s.setStartImage);
  const [isCapturing, setIsCapturing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const objectUrl = URL.createObjectURL(file);
      setStartImage({ type: 'file', blob: file, objectUrl });
    },
    [setStartImage],
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
    if (startImage?.type === 'file') {
      URL.revokeObjectURL(startImage.objectUrl);
    }
    setStartImage(null);
  }, [setStartImage, startImage]);

  const handleImageGenerated = useCallback(
    (source: ImageSource) => {
      if (startImage?.type === 'file') {
        URL.revokeObjectURL(startImage.objectUrl);
      }
      setStartImage(source);
    },
    [setStartImage, startImage],
  );

  const handleCapture = useCallback(async () => {
    setIsCapturing(true);
    try {
      const { captureFrame } = usePlaybackStore.getState();
      if (!captureFrame) return;
      const dataUrl = await captureFrame();
      if (!dataUrl) return;
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
      handleFile(file);
    } finally {
      setIsCapturing(false);
    }
  }, [handleFile]);

  const previewUrl =
    startImage?.type === 'file'
      ? startImage.objectUrl
      : startImage?.type === 'generated'
        ? startImage.url
        : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Start Image</span>
      <div
        className={`relative flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
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
            {startImage?.type === 'generated' && (
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
      <div className="flex items-center gap-1">
        <ImageGenDialog node="start" onImageGenerated={handleImageGenerated} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleCapture}
          disabled={isCapturing}
        >
          <Camera className="mr-1 h-3 w-3" />
          {isCapturing ? 'Capturing...' : 'Capture'}
        </Button>
      </div>
    </div>
  );
});
