import { useCallback, useState, useEffect, memo } from 'react';
import { Separator } from '@/components/ui/separator';
import { Cpu, Wifi, WifiOff } from 'lucide-react';
import { AudioWaveformMonitor } from './audio-waveform-monitor';
import { ScopeDynamicParams } from './scope-dynamic-params';
import { MasterPromptBox, PromptSnapButton, usePromptStore } from '../deps/prompt-engine';
import { useLiveSessionStore } from '../stores/live-session-store';
import { checkScopeHealth, getScopeHardwareInfo } from '../api/scope-health';
import { getScopePipelineSchemas, type PipelineParamSchema } from '../api/scope-pipeline';
import { updateScopePrompt, updateScopePromptThrottled } from '../api/scope-parameters';
import { updateDaydreamPrompt } from '../api/daydream-update-prompt';
import { generatePromptFromScope } from '../deps/prompt-engine';

interface AiSidebarLayoutProps {
  localStream: MediaStream | null;
}

/**
 * Zone 1: Input & Prompt Engine sidebar layout.
 * Composes: Webcam Feed, Audio Waveform, Snap Button, Master Prompt, Pipeline Params.
 */
export const AiSidebarLayout = memo(function AiSidebarLayout({
  localStream,
}: AiSidebarLayoutProps) {
  const scopeConnected = useLiveSessionStore((s) => s.scopeConnected);
  const scopeHardwareInfo = useLiveSessionStore((s) => s.scopeHardwareInfo);
  const scopeSession = useLiveSessionStore((s) => s.scopeSession);
  const streamActive = useLiveSessionStore((s) => s.streamActive);
  const streamId = useLiveSessionStore((s) => s.streamId);
  const scopePipeline = useLiveSessionStore((s) => s.scopePipeline);
  const setScopeConnected = useLiveSessionStore((s) => s.setScopeConnected);
  const setScopeHardwareInfo = useLiveSessionStore((s) => s.setScopeHardwareInfo);

  const autoApply = usePromptStore((s) => s.autoApply);

  const [allSchemas, setAllSchemas] = useState<Record<string, PipelineParamSchema[]>>({});
  // Select schema matching the active pipeline; fall back to first available
  const pipelineSchema = (scopePipeline && allSchemas[scopePipeline])
    ? allSchemas[scopePipeline]
    : (Object.values(allSchemas)[0] ?? []);

  // Probe Scope health on mount and refresh schemas when pipeline changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const healthy = await checkScopeHealth();
      if (cancelled) return;
      setScopeConnected(healthy);
      if (healthy) {
        const info = await getScopeHardwareInfo();
        if (!cancelled && info) setScopeHardwareInfo({ vram: info.vram, spout: info.spoutAvailable });
        const schemas = await getScopePipelineSchemas();
        if (!cancelled) {
          const normalized: Record<string, PipelineParamSchema[]> = {};
          for (const [name, rawSchema] of Object.entries(schemas)) {
            if (Array.isArray(rawSchema)) normalized[name] = rawSchema;
          }
          setAllSchemas(normalized);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [setScopeConnected, setScopeHardwareInfo, scopePipeline]);

  // Handle prompt application to active stream
  const handleApplyPrompt = useCallback(
    (prompt: string) => {
      if (scopeSession?.dataChannel) {
        updateScopePrompt(scopeSession.dataChannel, prompt);
      } else if (streamId) {
        updateDaydreamPrompt(streamId, { prompt }).catch(() => {
          // Silently fail; error will show in stream status
        });
      }
    },
    [scopeSession, streamId],
  );

  // Auto-apply prompt changes (throttled to avoid flooding Scope/Daydream)
  const currentPrompt = usePromptStore((s) => s.currentPrompt);
  useEffect(() => {
    if (!autoApply || !streamActive || !currentPrompt.trim()) return;
    // Use throttled variant when auto-applying on every keystroke
    if (scopeSession?.dataChannel) {
      updateScopePromptThrottled(scopeSession.dataChannel, currentPrompt.trim());
    } else if (streamId) {
      // Daydream Cloud is HTTP-based so natural latency acts as a throttle,
      // but we still guard against rapid-fire calls
      handleApplyPrompt(currentPrompt.trim());
    }
  }, [autoApply, streamActive, currentPrompt, scopeSession, streamId, handleApplyPrompt]);

  // Handle Snap: capture frame and generate prompt via Scope
  const handleSnap = useCallback(async (): Promise<string | null> => {
    if (!scopeSession?.dataChannel) return null;
    try {
      return await generatePromptFromScope(scopeSession.dataChannel);
    } catch {
      return null;
    }
  }, [scopeSession]);

  const dataChannel = scopeSession?.dataChannel ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Scope status */}
      <div className="flex items-center gap-2">
        {scopeConnected ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs">
            <Wifi className="h-3 w-3 text-green-500" />
            Scope Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            <WifiOff className="h-3 w-3" />
            Scope Offline
          </span>
        )}
        {scopeHardwareInfo && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
            <Cpu className="h-3 w-3" />
            {scopeHardwareInfo.vram}GB VRAM
          </span>
        )}
      </div>

      {/* Webcam feed -- rendered by parent (LiveAIPanelContent) via useBroadcast */}
      {/* This component only handles the waveform and prompt UI */}

      {/* Audio waveform monitor */}
      <AudioWaveformMonitor stream={localStream} height={60} />

      <Separator />

      {/* Snap button */}
      <PromptSnapButton
        onSnap={handleSnap}
        disabled={!scopeConnected || !scopeSession}
      />

      {/* Master prompt box */}
      <MasterPromptBox onApplyPrompt={handleApplyPrompt} />

      <Separator />

      {/* Dynamic pipeline parameters from Scope schema */}
      <ScopeDynamicParams schema={pipelineSchema} dataChannel={dataChannel} />
    </div>
  );
});
