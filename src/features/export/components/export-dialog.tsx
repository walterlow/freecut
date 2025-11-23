import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ExportSettings } from '@/types/export';
import { useRender } from '../hooks/use-render';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>({
    codec: 'h264',
    quality: 'high',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
  });

  const {
    isExporting,
    isUploading,
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    startExport,
    cancelExport,
    downloadVideo,
    resetState,
  } = useRender();

  // Handle dialog close
  const handleClose = () => {
    if (!isExporting) {
      onClose();
    }
  };

  // Start export
  const handleStartExport = async () => {
    await startExport(settings);
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export Video</DialogTitle>
          <DialogDescription>Configure export settings and render your video</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Settings Form */}
          {!isExporting && !isCompleted && !isFailed && !isCancelled && (
            <div className="space-y-4">
              {/* Codec */}
              <div className="space-y-2">
                <Label htmlFor="codec">Codec</Label>
                <Select
                  value={settings.codec}
                  onValueChange={(value) => setSettings({ ...settings, codec: value as any })}
                >
                  <SelectTrigger id="codec">
                    <SelectValue placeholder="Select codec" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="h264">H.264 (MP4)</SelectItem>
                    <SelectItem value="h265">H.265 (HEVC)</SelectItem>
                    <SelectItem value="vp8">VP8 (WebM)</SelectItem>
                    <SelectItem value="vp9">VP9 (WebM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quality */}
              <div className="space-y-2">
                <Label htmlFor="quality">Quality</Label>
                <Select
                  value={settings.quality}
                  onValueChange={(value) => setSettings({ ...settings, quality: value as any })}
                >
                  <SelectTrigger id="quality">
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low (Faster, smaller file)</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High (Recommended)</SelectItem>
                    <SelectItem value="ultra">Ultra (Slower, larger file)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Resolution */}
              <div className="space-y-2">
                <Label htmlFor="resolution">Resolution</Label>
                <Select
                  value={`${settings.resolution.width}x${settings.resolution.height}`}
                  onValueChange={(value) => {
                    const [width, height] = value.split('x').map(Number);
                    setSettings({ ...settings, resolution: { width, height } });
                  }}
                >
                  <SelectTrigger id="resolution">
                    <SelectValue placeholder="Select resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1280x720">720p (1280x720)</SelectItem>
                    <SelectItem value="1920x1080">1080p (1920x1080)</SelectItem>
                    <SelectItem value="2560x1440">1440p (2560x1440)</SelectItem>
                    <SelectItem value="3840x2160">4K (3840x2160)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* FPS */}
              <div className="space-y-2">
                <Label htmlFor="fps">Frame Rate</Label>
                <Select
                  value={String(settings.fps)}
                  onValueChange={(value) => setSettings({ ...settings, fps: Number(value) })}
                >
                  <SelectTrigger id="fps">
                    <SelectValue placeholder="Select frame rate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24 fps</SelectItem>
                    <SelectItem value="30">30 fps</SelectItem>
                    <SelectItem value="60">60 fps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading media files...</span>
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <Progress value={0} className="h-2" />
            </div>
          )}

          {/* Render Progress */}
          {isExporting && !isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Rendering... {renderedFrames && totalFrames ? `${renderedFrames}/${totalFrames} frames` : ''}
                </span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Success */}
          {isCompleted && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-600">
                Video rendered successfully! Click download to save.
              </AlertDescription>
            </Alert>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Cancelled */}
          {isCancelled && (
            <Alert>
              <X className="h-4 w-4" />
              <AlertDescription>Render cancelled</AlertDescription>
            </Alert>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {!isExporting && !isCompleted && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleStartExport}>Start Export</Button>
            </>
          )}

          {isExporting && (
            <Button variant="outline" onClick={cancelExport}>
              Cancel Render
            </Button>
          )}

          {isCompleted && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={downloadVideo}>
                <Download className="mr-2 h-4 w-4" />
                Download Video
              </Button>
            </>
          )}

          {(isFailed || isCancelled) && (
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
