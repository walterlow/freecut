import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Monitor,
  Cloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Download,
  Film,
  Clock,
  HardDrive,
  Music,
  Video,
} from 'lucide-react';
import type { ExportSettings, ExportMode } from '@/types/export';
import { useRender } from '../hooks/use-render';
import { useClientRender } from '../hooks/use-client-render';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { useSettingsStore } from '@/features/settings/stores/settings-store';
import type { ClientVideoContainer, ClientAudioContainer } from '../utils/client-renderer';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type RenderMode = 'client' | 'server';
type DialogView = 'settings' | 'progress' | 'complete' | 'error' | 'cancelled';

// Disable server rendering via env var (e.g., for Vercel deployment without render server)
const SERVER_RENDER_ENABLED = import.meta.env.VITE_ENABLE_SERVER_RENDER !== 'false';

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Generate resolution options based on project dimensions.
 */
function getResolutionOptions(projectWidth: number, projectHeight: number) {
  const scales = [1, 0.666, 0.5];

  return scales.map((scale) => {
    const w = Math.round(projectWidth * scale);
    const h = Math.round(projectHeight * scale);
    const width = w % 2 === 0 ? w : w + 1;
    const height = h % 2 === 0 ? h : h + 1;

    const label =
      scale === 1
        ? `Same as project (${width}×${height})`
        : `${Math.min(width, height)}p (${width}×${height})`;

    return { value: `${width}x${height}`, label };
  });
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const projectWidth = useProjectStore((s) => s.currentProject?.metadata.width ?? 1920);
  const projectHeight = useProjectStore((s) => s.currentProject?.metadata.height ?? 1080);

  const serverApiUrl = useSettingsStore((s) => s.serverApiUrl);
  const serverSocketUrl = useSettingsStore((s) => s.serverSocketUrl);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [settings, setSettings] = useState<ExportSettings>({
    codec: 'h264',
    quality: 'high',
    resolution: { width: projectWidth, height: projectHeight },
  });

  const [renderMode, setRenderMode] = useState<RenderMode>('client');
  const [exportMode, setExportMode] = useState<ExportMode>('video');
  const [videoContainer, setVideoContainer] = useState<ClientVideoContainer>('mp4');
  const [audioContainer, setAudioContainer] = useState<ClientAudioContainer>('mp3');
  const [view, setView] = useState<DialogView>('settings');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const resolutionOptions = useMemo(
    () => getResolutionOptions(projectWidth, projectHeight),
    [projectWidth, projectHeight]
  );

  // Sync resolution when project dimensions change
  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      resolution: { width: projectWidth, height: projectHeight },
    }));
  }, [projectWidth, projectHeight]);

  // Render hooks
  const serverRender = useRender();
  const clientRender = useClientRender();
  const activeRender = renderMode === 'client' ? clientRender : serverRender;

  const {
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    startExport,
    cancelExport,
    downloadVideo,
  } = activeRender;

  const isUploading = renderMode === 'server' && serverRender.isUploading;

  // Track elapsed time
  useEffect(() => {
    if (view === 'progress' && !startTime) {
      setStartTime(Date.now());
    }
    if (view === 'settings') {
      setStartTime(null);
      setElapsedSeconds(0);
    }
  }, [view, startTime]);

  useEffect(() => {
    if (!startTime || view !== 'progress') return;

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, view]);

  // Watch status changes to update view
  useEffect(() => {
    if (status === 'completed') {
      setView('complete');
    } else if (status === 'failed') {
      setView('error');
    } else if (status === 'cancelled') {
      setView('cancelled');
    }
  }, [status]);

  // Handle close
  const handleClose = () => {
    if (view === 'progress') return; // Prevent closing during export
    setView('settings');
    serverRender.resetState();
    clientRender.resetState();
    onClose();
  };

  // Start export
  const handleStartExport = async () => {
    setView('progress');
    // Create extended settings with export mode and container
    const extendedSettings = {
      ...settings,
      mode: exportMode,
      videoContainer: exportMode === 'video' ? videoContainer : undefined,
      audioContainer: exportMode === 'audio' ? audioContainer : undefined,
    };
    await startExport(extendedSettings);
  };

  // Handle mode change
  const handleModeChange = (mode: RenderMode) => {
    serverRender.resetState();
    clientRender.resetState();
    setRenderMode(mode);
  };

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setView('settings');
      serverRender.resetState();
      clientRender.resetState();
      setStartTime(null);
      setElapsedSeconds(0);
    }
  }, [open, serverRender, clientRender]);

  const getCodecOptions = () => {
    if (renderMode === 'server') {
      // Server mode has all codecs available
      return [
        { value: 'h264', label: 'H.264' },
        { value: 'h265', label: 'H.265/HEVC' },
        { value: 'vp8', label: 'VP8' },
        { value: 'vp9', label: 'VP9' },
      ];
    }
    // Client mode - codecs depend on container
    switch (videoContainer) {
      case 'mp4':
      case 'mov':
        return [
          { value: 'h264', label: 'H.264' },
          { value: 'h265', label: 'H.265/HEVC' },
        ];
      case 'webm':
        return [
          { value: 'vp8', label: 'VP8' },
          { value: 'vp9', label: 'VP9' },
        ];
      case 'mkv':
        return [
          { value: 'h264', label: 'H.264' },
          { value: 'h265', label: 'H.265/HEVC' },
          { value: 'vp8', label: 'VP8' },
          { value: 'vp9', label: 'VP9' },
        ];
      default:
        return [{ value: 'h264', label: 'H.264' }];
    }
  };

  const getVideoContainerOptions = () => [
    { value: 'mp4', label: 'MP4', description: 'Most compatible, H.264/H.265' },
    { value: 'mov', label: 'QuickTime (MOV)', description: 'Best for macOS/iOS' },
    { value: 'webm', label: 'WebM', description: 'Web-optimized, VP8/VP9' },
    { value: 'mkv', label: 'Matroska (MKV)', description: 'Flexible, all codecs' },
  ];

  const getAudioContainerOptions = () => [
    { value: 'mp3', label: 'MP3', description: 'Universal, small files' },
    { value: 'aac', label: 'AAC', description: 'High quality, compact' },
    { value: 'wav', label: 'WAV', description: 'Lossless, large files' },
  ];

  // Reset codec when container changes to ensure compatibility
  useEffect(() => {
    const validCodecs = getCodecOptions().map((o) => o.value);
    if (!validCodecs.includes(settings.codec)) {
      setSettings((prev) => ({ ...prev, codec: validCodecs[0] as ExportSettings['codec'] }));
    }
  }, [videoContainer]);

  const preventClose = view === 'progress' || view === 'complete';
  const fileSize = renderMode === 'client' ? clientRender.result?.fileSize : undefined;

  // Dynamic title and description
  const getTitle = () => {
    switch (view) {
      case 'settings':
        return 'Export Video';
      case 'progress':
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Exporting video...
          </span>
        );
      case 'complete':
        return (
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            Export complete!
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Export failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-2">
            <X className="h-5 w-5 text-muted-foreground" />
            Export cancelled
          </span>
        );
    }
  };

  const getDescription = () => {
    switch (view) {
      case 'settings':
        return 'Configure export settings and render your video';
      case 'progress':
        return renderMode === 'client' ? 'Rendering in your browser' : 'Processing on server';
      case 'complete':
        return 'Your video is ready to download';
      case 'error':
        return 'Something went wrong during export';
      case 'cancelled':
        return 'The export was cancelled';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose} modal>
      <DialogContent
        className="sm:max-w-[500px] overflow-hidden"
        hideCloseButton={preventClose}
        onPointerDownOutside={(e) => preventClose && e.preventDefault()}
        onEscapeKeyDown={(e) => preventClose && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        {/* Settings View */}
        {view === 'settings' && (
          <div className="space-y-6 py-4">
            {/* Export Mode: Video or Audio Toggle Group */}
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Export Type</Label>
              <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
                <button
                  type="button"
                  onClick={() => setExportMode('video')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                    exportMode === 'video'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Video className="h-3.5 w-3.5" />
                  Video
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('audio')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                    exportMode === 'audio'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Music className="h-3.5 w-3.5" />
                  Audio
                </button>
              </div>
            </div>

            {/* Video Export Settings */}
            {exportMode === 'video' && (
              <>
                {/* Render Mode: Browser or Server */}
                {SERVER_RENDER_ENABLED ? (
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
                          Renders in your browser using WebCodecs. No upload required.
                        </AlertDescription>
                      </Alert>
                    </TabsContent>

                    <TabsContent value="server" className="mt-4 space-y-4">
                      <Alert>
                        <Cloud className="h-4 w-4" />
                        <AlertDescription>
                          Uploads media to server for rendering with FFmpeg.
                        </AlertDescription>
                      </Alert>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="serverApiUrl" className="text-xs">Server URL</Label>
                          <Input
                            id="serverApiUrl"
                            type="url"
                            placeholder="http://localhost:3001/api"
                            value={serverApiUrl}
                            onChange={(e) => setSetting('serverApiUrl', e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="serverSocketUrl" className="text-xs">WebSocket URL</Label>
                          <Input
                            id="serverSocketUrl"
                            type="url"
                            placeholder="http://localhost:3001"
                            value={serverSocketUrl}
                            onChange={(e) => setSetting('serverSocketUrl', e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <Alert>
                    <Monitor className="h-4 w-4" />
                    <AlertDescription>
                      Renders in your browser using WebCodecs. No upload required.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  {/* Container Format (client mode only) */}
                  {renderMode === 'client' && (
                    <div className="space-y-2">
                      <Label htmlFor="container">Format</Label>
                      <Select
                        value={videoContainer}
                        onValueChange={(v) => setVideoContainer(v as ClientVideoContainer)}
                      >
                        <SelectTrigger id="container">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          {getVideoContainerOptions().map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span>{option.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">{option.description}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

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

                  <div className="space-y-2">
                    <Label htmlFor="resolution">Resolution</Label>
                    <Select
                      value={`${settings.resolution.width}x${settings.resolution.height}`}
                      onValueChange={(value) => {
                        const parts = value.split('x').map(Number);
                        const width = parts[0] ?? projectWidth;
                        const height = parts[1] ?? projectHeight;
                        setSettings({ ...settings, resolution: { width, height } });
                      }}
                    >
                      <SelectTrigger id="resolution">
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        {resolutionOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {/* Audio Export Settings */}
            {exportMode === 'audio' && (
              <div className="space-y-4">
                <Alert>
                  <Music className="h-4 w-4" />
                  <AlertDescription>
                    Exports audio only. Video tracks will be ignored.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="audio-format">Format</Label>
                  <Select
                    value={audioContainer}
                    onValueChange={(v) => setAudioContainer(v as ClientAudioContainer)}
                  >
                    <SelectTrigger id="audio-format">
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAudioContainerOptions().map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <span>{option.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{option.description}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="audio-quality">Quality</Label>
                  <Select
                    value={settings.quality}
                    onValueChange={(value) => setSettings({ ...settings, quality: value as ExportSettings['quality'] })}
                  >
                    <SelectTrigger id="audio-quality">
                      <SelectValue placeholder="Select quality" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low (96 kbps)</SelectItem>
                      <SelectItem value="medium">Medium (192 kbps)</SelectItem>
                      <SelectItem value="high">High (256 kbps)</SelectItem>
                      <SelectItem value="ultra">Ultra (320 kbps)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleStartExport}>
                {exportMode === 'audio'
                  ? 'Export Audio'
                  : renderMode === 'client'
                    ? 'Render in Browser'
                    : 'Start Export'}
              </Button>
            </div>
          </div>
        )}

        {/* Progress View */}
        {view === 'progress' && (
          <div className="space-y-4 py-4 overflow-hidden">
            <div className="space-y-4 min-w-0">
              <div className="space-y-2 min-w-0">
                <div className="w-full overflow-hidden">
                  <Progress value={progress} className="h-2 w-full" />
                </div>
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="text-muted-foreground truncate">
                    {isUploading && 'Uploading media files...'}
                    {!isUploading && status === 'preparing' && 'Preparing...'}
                    {!isUploading && (status === 'rendering' || status === 'processing') && 'Rendering frames...'}
                    {!isUploading && status === 'encoding' && 'Encoding...'}
                    {!isUploading && status === 'finalizing' && 'Finalizing...'}
                  </span>
                  <span className="font-medium tabular-nums flex-shrink-0">{Math.round(progress)}%</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {renderedFrames !== undefined && totalFrames !== undefined && (
                  <div className="flex items-center gap-2 text-sm">
                    <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Frames:</span>
                    <span className="font-medium tabular-nums">{renderedFrames}/{totalFrames}</span>
                  </div>
                )}
                {elapsedSeconds > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Elapsed:</span>
                    <span className="font-medium tabular-nums">{formatTime(elapsedSeconds)}</span>
                  </div>
                )}
              </div>

              {renderMode === 'client' && (
                <p className="text-xs text-muted-foreground">
                  Keep this tab open while rendering. Longer videos may take several minutes.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={cancelExport}>
                Cancel Export
              </Button>
            </div>
          </div>
        )}

        {/* Complete View */}
        {view === 'complete' && (
          <div className="space-y-4 py-4">
            <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Video exported successfully!
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {fileSize && (
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">File size:</span>
                  <span className="font-medium">{formatFileSize(fileSize)}</span>
                </div>
              )}
              {elapsedSeconds > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Time taken:</span>
                  <span className="font-medium">{formatTime(elapsedSeconds)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={downloadVideo}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        )}

        {/* Error View */}
        {view === 'error' && (
          <div className="space-y-4 py-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {/* Cancelled View */}
        {view === 'cancelled' && (
          <div className="space-y-4 py-4">
            <Alert>
              <X className="h-4 w-4" />
              <AlertDescription>The export process was cancelled.</AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
