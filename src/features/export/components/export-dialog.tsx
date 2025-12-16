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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Loader2, X, CheckCircle2, AlertCircle, Monitor, Cloud } from 'lucide-react';
import type { ExportSettings } from '@/types/export';
import { useRender } from '../hooks/use-render';
import { useClientRender } from '../hooks/use-client-render';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type RenderMode = 'client' | 'server';

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>({
    codec: 'h264',
    quality: 'high',
    resolution: { width: 1920, height: 1080 },
  });

  const [renderMode, setRenderMode] = useState<RenderMode>('client');

  // Server-side render hook
  const serverRender = useRender();

  // Client-side render hook
  const clientRender = useClientRender();

  // Select active render based on mode
  const activeRender = renderMode === 'client' ? clientRender : serverRender;

  const {
    isExporting,
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    startExport,
    cancelExport,
    downloadVideo,
  } = activeRender;

  // Server-specific state
  const isUploading = renderMode === 'server' && serverRender.isUploading;

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
      serverRender.resetState();
      clientRender.resetState();
    }
  }, [open, serverRender, clientRender]);

  // Reset both when switching modes
  const handleModeChange = (mode: RenderMode) => {
    if (!isExporting) {
      serverRender.resetState();
      clientRender.resetState();
      setRenderMode(mode);
    }
  };

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';

  // Get available codecs based on render mode
  const getCodecOptions = () => {
    if (renderMode === 'client') {
      // Client-side: WebCodecs-based, limited options
      return [
        { value: 'h264', label: 'H.264 (MP4)' },
        { value: 'vp9', label: 'VP9 (WebM)' },
      ];
    } else {
      // Server-side: Full FFmpeg support
      return [
        { value: 'h264', label: 'H.264 (MP4)' },
        { value: 'h265', label: 'H.265 (HEVC)' },
        { value: 'vp8', label: 'VP8 (WebM)' },
        { value: 'vp9', label: 'VP9 (WebM)' },
      ];
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export Video</DialogTitle>
          <DialogDescription>Configure export settings and render your video</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Render Mode Tabs - only show when not exporting */}
          {!isExporting && !isCompleted && !isFailed && !isCancelled && (
            <Tabs value={renderMode} onValueChange={(v) => handleModeChange(v as RenderMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="client" className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  Browser
                </TabsTrigger>
                <TabsTrigger value="server" className="flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  Server
                </TabsTrigger>
              </TabsList>

              <TabsContent value="client" className="mt-4">
                <Alert>
                  <Monitor className="h-4 w-4" />
                  <AlertDescription>
                    Renders entirely in your browser using WebCodecs. No upload required, but limited codec support.
                  </AlertDescription>
                </Alert>
              </TabsContent>

              <TabsContent value="server" className="mt-4">
                <Alert>
                  <Cloud className="h-4 w-4" />
                  <AlertDescription>
                    Uploads media to server for rendering with FFmpeg. Better quality and more codec options.
                  </AlertDescription>
                </Alert>
              </TabsContent>
            </Tabs>
          )}

          {/* Settings Form */}
          {!isExporting && !isCompleted && !isFailed && !isCancelled && (
            <div className="space-y-4">
              {/* Codec */}
              <div className="space-y-2">
                <Label htmlFor="codec">Codec</Label>
                <Select
                  value={settings.codec}
                  onValueChange={(value) => setSettings({ ...settings, codec: value as ExportSettings['codec'] })}
                >
                  <SelectTrigger id="codec">
                    <SelectValue placeholder="Select codec" />
                  </SelectTrigger>
                  <SelectContent>
                    {getCodecOptions().map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Quality */}
              <div className="space-y-2">
                <Label htmlFor="quality">Quality</Label>
                <Select
                  value={settings.quality}
                  onValueChange={(value) => setSettings({ ...settings, quality: value as ExportSettings['quality'] })}
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
                    const parts = value.split('x').map(Number);
                    const width = parts[0] ?? 1920;
                    const height = parts[1] ?? 1080;
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
            </div>
          )}

          {/* Upload Progress (server mode only) */}
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
                  {status === 'preparing' && 'Preparing...'}
                  {status === 'rendering' && `Rendering... ${renderedFrames && totalFrames ? `${renderedFrames}/${totalFrames} frames` : ''}`}
                  {status === 'encoding' && 'Encoding...'}
                  {status === 'finalizing' && 'Finalizing...'}
                  {status === 'processing' && `Rendering... ${renderedFrames && totalFrames ? `${renderedFrames}/${totalFrames} frames` : ''}`}
                </span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              {renderMode === 'client' && (
                <p className="text-xs text-muted-foreground">
                  Rendering in browser - this may take a while for longer videos
                </p>
              )}
            </div>
          )}

          {/* Success */}
          {isCompleted && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-600">
                Video rendered successfully! Click download to save.
                {renderMode === 'client' && clientRender.result && (
                  <span className="block mt-1 text-xs">
                    File size: {(clientRender.result.fileSize / (1024 * 1024)).toFixed(2)} MB
                  </span>
                )}
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
              <Button onClick={handleStartExport}>
                {renderMode === 'client' ? 'Render in Browser' : 'Start Export'}
              </Button>
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
