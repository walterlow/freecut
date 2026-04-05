import { useCallback, useRef, useEffect, memo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Play } from 'lucide-react';
import { useGenerativeStore, type BridgeMode } from '../stores/generative-store';

interface NodeBridgeProps {
  /** Remote MediaStream from Scope/Daydream AI output. */
  remoteStream: MediaStream | null;
}

/**
 * Node B: Generative Bridge.
 * Central video player showing the live AI output with a Real-Time / Interpolation toggle.
 */
export const NodeBridge = memo(function NodeBridge({ remoteStream }: NodeBridgeProps) {
  const bridgeMode = useGenerativeStore((s) => s.bridgeMode);
  const setBridgeMode = useGenerativeStore((s) => s.setBridgeMode);
  const renderStatus = useGenerativeStore((s) => s.renderStatus);
  const pipelineReady = useGenerativeStore((s) => s.pipelineReady);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Bind remote stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !remoteStream) return;
    video.srcObject = remoteStream;
    video.play().catch(() => {
      // Autoplay may be blocked; user interaction required
    });
    return () => {
      video.srcObject = null;
    };
  }, [remoteStream]);

  const handleModeToggle = useCallback(
    (checked: boolean) => {
      const mode: BridgeMode = checked ? 'interpolation' : 'realtime';
      setBridgeMode(mode);
    },
    [setBridgeMode],
  );

  const isLoading = renderStatus === 'loading-pipeline';

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Generative Bridge</span>
      <div className="relative flex h-40 w-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-black">
        {remoteStream ? (
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Play className="h-8 w-8" />
            <span className="text-xs">Start stream to preview</span>
          </div>
        )}
        {/* Pipeline loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">Loading pipeline...</span>
            </div>
          </div>
        )}
      </div>
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Label
          className={`text-xs ${bridgeMode === 'realtime' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          Real-Time
        </Label>
        <Switch
          checked={bridgeMode === 'interpolation'}
          onCheckedChange={handleModeToggle}
          disabled={isLoading || !pipelineReady}
        />
        <Label
          className={`text-xs ${bridgeMode === 'interpolation' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          Interpolation
        </Label>
      </div>
    </div>
  );
});
