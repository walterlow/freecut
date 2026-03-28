'use client';

import { Component, useEffect, useRef, useCallback, useState } from 'react';
import { Circle, Settings, CameraOff, Maximize2, Minimize } from 'lucide-react';
import { useAccount } from '@account-kit/react';
import { useBroadcast, usePlayer } from '@daydreamlive/react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useLiveSessionStore } from '../stores/live-session-store';
import { useBillingLoop } from '../hooks/use-billing-loop';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore, useProjectStore } from '../deps/editor';
import { createStream, isDaydreamConfigured } from '../api/create-stream';
import {
  createLiveVideoToVideoSession,
  isLivepeerStudioConfigured,
} from '../api/livepeer-studio-live-video';
import { updateDaydreamPrompt } from '../api/daydream-update-prompt';
import { resolvePlaybackWhepUrl } from '../api/resolve-playback-url';
import {
  getStreamStatus,
  DAYDREAM_API_LOGS_URL,
  type StreamStatusResponse,
} from '../api/stream-status';
import type { CuratedLoraPreset } from '../config/curated-loras';
import {
  getCuratedLorasForFamily,
  getFamilyForModelId,
  getModelLabelForId,
  getTriggerWordsForModelIds,
  isSD15Model,
  isSDXLTurboModel,
} from '../config/curated-loras';
import type { StreamData, LoraDict, IpAdapterConfig } from '../types';

const MODEL_OPTIONS = [
  { value: 'stabilityai/sd-turbo', label: 'SD 2.1 Turbo' },
  { value: 'stabilityai/sdxl-turbo', label: 'SDXL Turbo' },
  { value: 'Lykon/dreamshaper-8', label: 'Dreamshaper 8' },
  { value: 'prompthero/openjourney-v4', label: 'Open Journey v4' },
] as const;

const LORA_SCALE_MIN = 0.1;
const LORA_SCALE_MAX = 2;

interface LoraEntry {
  id: string;
  path: string;
  scale: number;
}

function nextLoraId(): string {
  return `lora-${Math.random().toString(36).slice(2, 11)}`;
}

function loraEntriesToDict(entries: LoraEntry[]): LoraDict {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const p = e.path.trim();
    if (p) out[p] = e.scale;
  }
  return Object.keys(out).length ? out : null;
}

function validateLoraEntries(entries: LoraEntry[]): string | null {
  const dict = loraEntriesToDict(entries);
  if (!dict) return null;
  for (const scale of Object.values(dict)) {
    if (scale < LORA_SCALE_MIN || scale > LORA_SCALE_MAX) {
      return `LoRA scale must be between ${LORA_SCALE_MIN} and ${LORA_SCALE_MAX}.`;
    }
  }
  return null;
}

const DEFAULT_STREAM_PARAMS = {
  pipeline: 'streamdiffusion' as const,
  params: {
    model_id: 'stabilityai/sd-turbo',
    prompt: 'a serene landscape, vibrant colors',
    width: 512,
    height: 512,
  },
};

/** SD1.5-specific stream params per Daydream docs. */
const SD15_STREAM_PARAMS = {
  num_inference_steps: 50,
  t_index_list: [5, 15, 32],
  use_lcm_lora: true,
  lcm_lora_id: 'latent-consistency/lcm-lora-sdv1-5',
  guidance_scale: 1,
} as const;

const WHIP_PROXY_PREFIX = '/api/whip-proxy';

function toProxyWhipUrlIfNeeded(whipUrl: string): string {
  if (!import.meta.env.DEV || typeof window === 'undefined') return whipUrl;
  if (!whipUrl.includes('livepeer.com')) return whipUrl;
  try {
    const normalized = whipUrl.startsWith('http') ? whipUrl : `https://${whipUrl.replace(/^\/+/, '')}`;
    const u = new URL(normalized);
    return `${window.location.origin}${WHIP_PROXY_PREFIX}${u.pathname}${u.search}`;
  } catch {
    return whipUrl;
  }
}

type PreviewView = 'camera' | 'ai';

interface LiveAISessionWithBroadcastProps {
  streamData: StreamData;
  whipUrl: string;
  localStream: MediaStream | null;
  onStreamStopped: () => void;
  previewView: PreviewView;
  setPreviewView: (v: PreviewView) => void;
  /** When true, poll Daydream stream status and show API logs link while buffering. */
  isDaydreamStream?: boolean;
  /** Current model id (for SD1.5 cold start messaging). */
  selectedModelId?: string;
}

/** Optional billing: setOnPause and billingEnabled. When billingEnabled is false, billing UI and loop are skipped. */
interface LiveAISessionCoreProps extends LiveAISessionWithBroadcastProps {
  setOnPause: (fn: (() => void) | null) => void;
  billingEnabled: boolean;
}

// No-op when wallet not connected; billing loop is not run.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional no-op
const noopSetOnPause = (_fn: (() => void) | null) => {};

/** Shared panel body (consent, session, settings, footer). Used in sidebar and floating popover. */
export function LiveAIPanelContent() {
  const { address } = useAccount({ type: 'LightAccount' });
  const setPermissionsGranted = useLiveSessionStore((s) => s.setPermissionsGranted);
  const includeTimelineAudio = useLiveSessionStore((s) => s.includeTimelineAudio);
  const setIncludeTimelineAudio = useLiveSessionStore((s) => s.setIncludeTimelineAudio);
  const isRecording = useLiveSessionStore((s) => s.isRecording);
  const setRecording = useLiveSessionStore((s) => s.setRecording);
  const recordedTakes = useLiveSessionStore((s) => s.recordedTakes);
  const insertRecordedClip = useTimelineStore((s) => s.insertRecordedClip);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [committing, setCommitting] = useState(false);

  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [streamSource, setStreamSource] = useState<'daydream' | 'livepeer' | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [previewView, setPreviewView] = useState<PreviewView>('ai');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentRequested, setConsentRequested] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_STREAM_PARAMS.params.model_id ?? 'stabilityai/sd-turbo');
  const [prompt, setPrompt] = useState(DEFAULT_STREAM_PARAMS.params.prompt ?? '');
  const [loraEntries, setLoraEntries] = useState<LoraEntry[]>([]);
  const [promptUpdating, setPromptUpdating] = useState(false);
  const [loraUpdating, setLoraUpdating] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [loraError, setLoraError] = useState<string | null>(null);
  const [promptApplied, setPromptApplied] = useState(false);
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  const [faceIdImageUrl, setFaceIdImageUrl] = useState('');
  const [faceIdUpdating, setFaceIdUpdating] = useState(false);
  const [faceIdError, setFaceIdError] = useState<string | null>(null);

  const daydreamConfigured = isDaydreamConfigured();
  const livepeerConfigured = isLivepeerStudioConfigured();
  const configured = daydreamConfigured || livepeerConfigured;
  const curatedPresets = getCuratedLorasForFamily(getFamilyForModelId(selectedModelId));
  const triggerHints = getTriggerWordsForModelIds(loraEntries.map((e) => e.path));

  // Cleanup on unmount: stop broadcast and release tracks
  useEffect(() => {
    return () => {
      setStreamData(null);
      setLocalStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
      setError(null);
      setPermissionDenied(false);
      setConsentRequested(false);
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (!configured) return;
    if (daydreamConfigured) {
      const validationErr = validateLoraEntries(loraEntries);
      if (validationErr) {
        setError(validationErr);
        return;
      }
    }
    setConsentRequested(true);
    setError(null);
    setPermissionDenied(false);
    setLoading(true);
    try {
      let data: StreamData;
      if (livepeerConfigured) {
        data = await createLiveVideoToVideoSession({ model_id: '', params: {} });
        setStreamSource('livepeer');
      } else {
        const lora_dict = loraEntriesToDict(loraEntries);
        const sd15Extra = isSD15Model(selectedModelId) ? SD15_STREAM_PARAMS : {};
        const faceIdExtra: Record<string, unknown> = {};
        if (isSDXLTurboModel(selectedModelId) && faceIdEnabled && faceIdImageUrl.trim()) {
          faceIdExtra.ip_adapter = { type: 'faceid', scale: 1, enabled: true } satisfies IpAdapterConfig;
          faceIdExtra.ip_adapter_style_image_url = faceIdImageUrl.trim();
        }
        const params = {
          ...DEFAULT_STREAM_PARAMS,
          params: {
            ...DEFAULT_STREAM_PARAMS.params,
            model_id: selectedModelId,
            prompt: prompt.trim() || DEFAULT_STREAM_PARAMS.params.prompt,
            ...(lora_dict && { lora_dict }),
            ...sd15Extra,
            ...faceIdExtra,
          },
        };
        data = await createStream(params);
        data = { ...data, whipUrl: toProxyWhipUrlIfNeeded(data.whipUrl) };
        setStreamSource('daydream');
      }
      setStreamData(data);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 512, height: 512 },
        audio: false,
      });
      setLocalStream(stream);
      setPermissionsGranted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start';
      setError(msg);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setPermissionDenied(true);
      }
    } finally {
      setLoading(false);
    }
  }, [configured, daydreamConfigured, livepeerConfigured, setPermissionsGranted, selectedModelId, prompt, loraEntries, faceIdEnabled, faceIdImageUrl]);

  const handleApplyPrompt = useCallback(async () => {
    if (streamSource !== 'daydream' || !streamData?.id || !prompt.trim()) return;
    setPromptError(null);
    setPromptApplied(false);
    setPromptUpdating(true);
    try {
      await updateDaydreamPrompt(streamData.id, { prompt: prompt.trim() });
      setPromptApplied(true);
      setTimeout(() => setPromptApplied(false), 2000);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to apply prompt');
    } finally {
      setPromptUpdating(false);
    }
  }, [streamSource, streamData?.id, prompt]);

  const handleApplyLoras = useCallback(async () => {
    if (streamSource !== 'daydream' || !streamData?.id) return;
    const err = validateLoraEntries(loraEntries);
    if (err) {
      setLoraError(err);
      return;
    }
    setLoraError(null);
    setLoraUpdating(true);
    try {
      const lora_dict = loraEntriesToDict(loraEntries);
      await updateDaydreamPrompt(streamData.id, {
        prompt: (prompt.trim() || DEFAULT_STREAM_PARAMS.params.prompt) ?? '',
        lora_dict: lora_dict ?? undefined,
      });
    } catch (e) {
      setLoraError(e instanceof Error ? e.message : 'Failed to apply LoRAs');
    } finally {
      setLoraUpdating(false);
    }
  }, [streamSource, streamData?.id, prompt, loraEntries]);

  const handleApplyFaceId = useCallback(async () => {
    if (streamSource !== 'daydream' || !streamData?.id) return;
    if (faceIdEnabled && !faceIdImageUrl.trim()) {
      setFaceIdError('Provide a reference face image URL.');
      return;
    }
    setFaceIdError(null);
    setFaceIdUpdating(true);
    try {
      await updateDaydreamPrompt(streamData.id, {
        prompt: (prompt.trim() || DEFAULT_STREAM_PARAMS.params.prompt) ?? '',
        ip_adapter: { type: 'faceid', scale: 1, enabled: faceIdEnabled },
        ...(faceIdEnabled && faceIdImageUrl.trim()
          ? { ip_adapter_style_image_url: faceIdImageUrl.trim() }
          : {}),
      });
    } catch (e) {
      setFaceIdError(e instanceof Error ? e.message : 'Failed to update FaceID');
    } finally {
      setFaceIdUpdating(false);
    }
  }, [streamSource, streamData?.id, prompt, faceIdEnabled, faceIdImageUrl]);

  const addLoraPreset = useCallback((preset: CuratedLoraPreset) => {
    setLoraEntries((prev) => [...prev, { id: nextLoraId(), path: preset.modelId, scale: preset.defaultScale }]);
  }, []);
  const addLoraRow = useCallback(() => {
    setLoraEntries((prev) => [...prev, { id: nextLoraId(), path: '', scale: 0.8 }]);
  }, []);
  const removeLoraRow = useCallback((id: string) => {
    setLoraEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const updateLoraEntry = useCallback((id: string, field: 'path' | 'scale', value: string | number) => {
    setLoraEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  }, []);

  const handleStreamStopped = useCallback(() => {
    setLocalStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setStreamData(null);
    setStreamSource(null);
  }, []);

  const whipUrl = streamData ? streamData.whipUrl : '';
  const showSession = streamData && whipUrl;

  return (
    <>
      <div className="p-3 flex-1 min-h-0 overflow-auto border-b border-border">
        {!configured && (
          <p className="text-xs text-muted-foreground">
            Set VITE_DAYDREAM_API_KEY or VITE_LIVEPEER_STUDIO_API_KEY in .env.local
          </p>
        )}

        {configured && !showSession && (
          <>
            {permissionDenied && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CameraOff className="w-10 h-10 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Camera access denied. Allow camera in browser settings and try again.
                </p>
              </div>
            )}
            {!permissionDenied && !consentRequested && (
              <p className="text-xs text-muted-foreground mb-2">
                Camera will be used for AI generation. Click Start to continue.
              </p>
            )}
            {error && !permissionDenied && (
              <p className="text-xs text-destructive mb-2">{error}</p>
            )}
            <Button
              onClick={handleStart}
              disabled={loading}
              size="sm"
              className="w-full"
            >
              {loading ? 'Starting…' : 'Start'}
            </Button>
          </>
        )}

        {showSession &&
          (address ? (
            <LiveAISessionBillingErrorBoundary
              sessionProps={{
                streamData,
                whipUrl,
                localStream,
                onStreamStopped: handleStreamStopped,
                previewView,
                setPreviewView,
                isDaydreamStream: streamSource === 'daydream',
                selectedModelId,
              }}
            >
              <LiveAISessionWithBroadcastWithBilling
                streamData={streamData}
                whipUrl={whipUrl}
                localStream={localStream}
                onStreamStopped={handleStreamStopped}
                previewView={previewView}
                setPreviewView={setPreviewView}
                isDaydreamStream={streamSource === 'daydream'}
                selectedModelId={selectedModelId}
              />
            </LiveAISessionBillingErrorBoundary>
          ) : (
            <LiveAISessionWithBroadcastCore
              streamData={streamData}
              whipUrl={whipUrl}
              localStream={localStream}
              onStreamStopped={handleStreamStopped}
              previewView={previewView}
              setPreviewView={setPreviewView}
              setOnPause={noopSetOnPause}
              billingEnabled={false}
              isDaydreamStream={streamSource === 'daydream'}
              selectedModelId={selectedModelId}
            />
          ))}
      </div>

      {settingsOpen && (
        <div className="p-3 border-t border-border bg-muted/30 overflow-auto max-h-[40vh] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Settings</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSettingsOpen(false)}>
              Collapse
            </Button>
          </div>
          {!showSession && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Model (used when you Start)</Label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {streamSource === 'daydream' && streamData && (
            <>
              <div className="space-y-1">
                <Label htmlFor="live-ai-prompt" className="text-xs text-muted-foreground">
                  Style prompt
                </Label>
                <textarea
                  id="live-ai-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. vibrant watercolor, cyberpunk city"
                  rows={3}
                  className="min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleApplyPrompt}
                  disabled={promptUpdating || !prompt.trim()}
                >
                  {promptUpdating ? 'Applying…' : promptApplied ? 'Applied' : 'Apply prompt'}
                </Button>
                {promptError && <p className="text-xs text-destructive">{promptError}</p>}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  LoRAs — {getModelLabelForId(selectedModelId)}. Changing triggers pipeline reload (~30s).
                </p>
                <div className="flex flex-wrap gap-1">
                  {curatedPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => addLoraPreset(preset)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                {loraEntries.map((entry) => (
                  <div key={entry.id} className="flex gap-1 flex-wrap items-center">
                    <input
                      type="text"
                      value={entry.path}
                      onChange={(e) => updateLoraEntry(entry.id, 'path', e.target.value)}
                      placeholder="HuggingFace ID or path"
                      className="flex-1 min-w-[120px] rounded border border-input bg-background px-2 py-1 text-xs"
                    />
                    <input
                      type="number"
                      min={LORA_SCALE_MIN}
                      max={LORA_SCALE_MAX}
                      step={0.1}
                      value={entry.scale}
                      onChange={(e) => updateLoraEntry(entry.id, 'scale', Number(e.target.value) || 0.8)}
                      className="w-14 rounded border border-input bg-background px-2 py-1 text-xs"
                      title="Scale"
                    />
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeLoraRow(entry.id)} aria-label="Remove LoRA">
                      ×
                    </Button>
                  </div>
                ))}
                <div className="flex gap-1 flex-wrap">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addLoraRow}>
                    Add custom LoRA
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleApplyLoras}
                    disabled={loraUpdating}
                  >
                    {loraUpdating ? 'Reloading…' : 'Apply LoRAs'}
                  </Button>
                </div>
                {loraError && <p className="text-xs text-destructive">{loraError}</p>}
                {triggerHints.length > 0 && (
                  <p className="text-xs text-muted-foreground">Trigger words: {triggerHints.join(', ')}</p>
                )}
              </div>
              {isSDXLTurboModel(selectedModelId) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="live-ai-faceid"
                      checked={faceIdEnabled}
                      onCheckedChange={setFaceIdEnabled}
                    />
                    <Label htmlFor="live-ai-faceid" className="text-xs cursor-pointer">
                      FaceID (IP Adapter)
                    </Label>
                  </div>
                  {faceIdEnabled && (
                    <>
                      <input
                        type="url"
                        value={faceIdImageUrl}
                        onChange={(e) => setFaceIdImageUrl(e.target.value)}
                        placeholder="Reference face image URL"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleApplyFaceId}
                        disabled={faceIdUpdating || !faceIdImageUrl.trim()}
                      >
                        {faceIdUpdating ? 'Applying…' : 'Apply FaceID'}
                      </Button>
                      {faceIdError && <p className="text-xs text-destructive">{faceIdError}</p>}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 px-3 py-2 border-t border-border flex-shrink-0 flex-wrap">
        {!isRecording ? (
          <Button
            variant="destructive"
            size="icon"
            className="h-10 w-10 rounded-full shrink-0"
            aria-label="Record"
            disabled={!showSession}
            onClick={() => {
              if (includeTimelineAudio) {
                usePlaybackStore.getState().play();
              }
              setRecording(true);
            }}
          >
            <Circle className="w-5 h-5 fill-current" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label="Stop recording"
            onClick={() => setRecording(false)}
          >
            Stop
          </Button>
        )}
        {recordedTakes.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => {
                const take = recordedTakes[recordedTakes.length - 1];
                const url = URL.createObjectURL(take.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `live-ai-${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 text-xs"
              disabled={!currentProject?.id || committing}
              onClick={async () => {
                const take = recordedTakes[recordedTakes.length - 1];
                const projectId = currentProject?.id;
                if (!projectId) return;
                setCommitting(true);
                try {
                  await insertRecordedClip({
                    blob: take.blob,
                    durationMs: take.durationMs,
                    linkedTimelineStart: take.linkedTimelineStart,
                    projectId,
                  });
                } finally {
                  setCommitting(false);
                }
              }}
            >
              {committing ? 'Adding…' : 'Commit to timeline'}
            </Button>
          </>
        )}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Switch
            id="live-ai-include-timeline-audio"
            checked={includeTimelineAudio}
            onCheckedChange={setIncludeTimelineAudio}
          />
          <Label htmlFor="live-ai-include-timeline-audio" className="text-xs truncate cursor-pointer">
            Include Timeline Audio
          </Label>
        </div>
        <Button
          variant={settingsOpen ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Session settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </>
  );
}

/** No-op: Live AI always uses the sidebar slide-out panel on both mobile and desktop. */
function LiveAIPopoverFloating() {
  return null;
}

const STREAM_STATUS_POLL_INTERVAL_MS = 5000;
const STREAM_STATUS_POLL_MAX_MS = 120000;
const SD15_COLD_START_TIMEOUT_MS = 90000;

const SD15_MODEL_IDS = new Set(['Lykon/dreamshaper-8', 'prompthero/openjourney-v4']);

function LiveAISessionWithBroadcastCore({
  streamData,
  whipUrl,
  localStream,
  onStreamStopped,
  previewView,
  setPreviewView,
  setOnPause,
  billingEnabled,
  isDaydreamStream = false,
  selectedModelId,
}: LiveAISessionCoreProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [outputWhepUrl, setOutputWhepUrl] = useState<string | null>(null);
  const [outputWhepUrlError, setOutputWhepUrlError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatusResponse | null>(null);
  const [showColdStartTimeoutMessage, setShowColdStartTimeoutMessage] = useState(false);
  const sessionStartRef = useRef<number>(Date.now());
  const isSd15 = Boolean(selectedModelId && SD15_MODEL_IDS.has(selectedModelId));

  const broadcast = useBroadcast({ whipUrl, reconnect: { enabled: true } });
  const player = usePlayer({
    whepUrl: outputWhepUrl ?? null,
    autoPlay: true,
    reconnect: { enabled: true },
  });

  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const isRecording = useLiveSessionStore((s) => s.isRecording);
  const setRecording = useLiveSessionStore((s) => s.setRecording);
  const includeTimelineAudio = useLiveSessionStore((s) => s.includeTimelineAudio);
  const addRecordedTake = useLiveSessionStore((s) => s.addRecordedTake);
  const setStreamActive = useLiveSessionStore((s) => s.setStreamActive);
  const setStreamId = useLiveSessionStore((s) => s.setStreamId);
  const billingError = useLiveSessionStore((s) => s.billingError);
  const setBillingError = useLiveSessionStore((s) => s.setBillingError);
  const { address } = useAccount({ type: 'LightAccount' });
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<number>(0);
  const linkedTimelineStartRef = useRef<number>(0);

  // Resolve output WHEP URL from Livepeer playback API (AI output), not broadcast's whepUrl.
  useEffect(() => {
    const playbackId = streamData?.outputPlaybackId;
    if (!playbackId) {
      setOutputWhepUrl(null);
      setOutputWhepUrlError(null);
      return;
    }
    setOutputWhepUrl(null);
    let cancelled = false;
    setOutputWhepUrlError(null);
    resolvePlaybackWhepUrl(playbackId)
      .then((url) => {
        if (!cancelled) {
          if (url) setOutputWhepUrl(url);
          else setOutputWhepUrlError('Could not load playback URL');
        }
      })
      .catch(() => {
        if (!cancelled) setOutputWhepUrlError('Could not load playback URL');
      });
    return () => {
      cancelled = true;
    };
  }, [streamData?.outputPlaybackId]);

  useEffect(() => {
    const active = broadcast.status.state === 'live';
    setStreamActive(active);
    setStreamId(active && streamData?.id ? streamData.id : null);
  }, [broadcast.status.state, streamData?.id, setStreamActive, setStreamId]);

  useEffect(() => {
    return () => {
      setStreamActive(false);
      setStreamId(null);
    };
  }, [setStreamActive, setStreamId]);

  useEffect(() => {
    setOnPause(() => {
      broadcast.stop();
      localStream?.getTracks().forEach((t) => t.stop());
      onStreamStopped();
    });
    return () => setOnPause(null);
  }, [setOnPause, broadcast, localStream, onStreamStopped]);

  useEffect(() => {
    if (!outputWhepUrl || player.status.state === 'playing' || player.status.state === 'connecting') return;
    player.play().catch(() => {});
  }, [outputWhepUrl, player.status.state]);

  // Poll Daydream stream status while output is not playing (diagnostics / cold start).
  useEffect(() => {
    if (
      !isDaydreamStream ||
      !streamData?.id ||
      player.status.state === 'playing' ||
      !outputWhepUrl
    ) {
      setStreamStatus(null);
      return;
    }
    const start = Date.now();
    const tick = () => {
      if (Date.now() - start > STREAM_STATUS_POLL_MAX_MS) return;
      getStreamStatus(streamData.id).then((res) => {
        if (res) setStreamStatus(res);
      });
    };
    tick();
    const id = setInterval(tick, STREAM_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [
    isDaydreamStream,
    streamData?.id,
    outputWhepUrl,
    player.status.state,
  ]);

  // SD1.5 cold start: reset session start when we get output URL; show timeout message after 90s.
  useEffect(() => {
    if (outputWhepUrl) sessionStartRef.current = Date.now();
  }, [outputWhepUrl]);
  useEffect(() => {
    if (player.status.state === 'playing') {
      setShowColdStartTimeoutMessage(false);
      return;
    }
    if (!outputWhepUrl || !isSd15) return;
    const id = setTimeout(() => {
      setShowColdStartTimeoutMessage(true);
    }, SD15_COLD_START_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [outputWhepUrl, isSd15, player.status.state]);

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
    return () => {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    };
  }, [localStream]);

  useEffect(() => {
    if (localStream && broadcast.status.state === 'idle') {
      broadcast.start(localStream).catch(() => {});
    }
  }, [localStream, broadcast.status.state]);

  useEffect(() => {
    const video = player.videoRef?.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const paint = () => {
      if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
      }
      rafId = requestAnimationFrame(paint);
    };
    let rafId = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafId);
  }, [player.videoRef]);

  // Recording: start/stop MediaRecorder when isRecording changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isRecording && !recorderRef.current) {
      try {
        const stream = canvas.captureStream(30);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const durationMs = Date.now() - recordingStartRef.current;
          addRecordedTake({
            blob,
            durationMs,
            linkedTimelineStart: linkedTimelineStartRef.current,
          });
          setRecording(false);
        };
        recorderRef.current = recorder;
        recordingStartRef.current = Date.now();
        linkedTimelineStartRef.current = usePlaybackStore.getState().currentFrame;
        recorder.start(100);
      } catch {
        setRecording(false);
      }
      return;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, [isRecording, addRecordedTake, setRecording]);

  const handleStop = useCallback(() => {
    broadcast.stop();
    localStream?.getTracks().forEach((t) => t.stop());
    setStreamActive(false);
    setStreamId(null);
    setBillingError(null);
    onStreamStopped();
  }, [broadcast, localStream, onStreamStopped, setStreamActive, setStreamId, setBillingError]);

  return (
    <>
      {!billingEnabled && (
        <p className="mb-2 text-xs text-muted-foreground">
          Connect your wallet to enable billing for this session.
        </p>
      )}
      {billingEnabled && billingError && (
        <div className="mb-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs">
          {billingError === 'insufficient_balance' && (
            <div className="flex flex-col gap-2">
              <p>Top up USDC on Arbitrum to continue.</p>
              <Button
                variant="outline"
                size="sm"
                className="w-fit text-xs"
                onClick={() => void openBuyUsdc({ address: address ?? undefined })}
                disabled={isOnrampLoading}
              >
                {isOnrampLoading ? 'Opening…' : 'Buy USDC'}
              </Button>
            </div>
          )}
          {billingError === 'session_limit_exceeded' && (
            <p>You&apos;ve used 10 USDC this session. Authorize another 10 USDC to continue?</p>
          )}
          {billingError === 'rpc_or_unknown' && (
            <p>Billing failed. Check connection and try again.</p>
          )}
        </div>
      )}
      <div className="flex gap-1 mb-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={handleStop} aria-label="Stop broadcast">
          Stop
        </Button>
        <div className="flex gap-1 ml-auto">
          <Button
            variant={previewView === 'camera' ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => setPreviewView('camera')}
          >
            Camera
          </Button>
          <Button
            variant={previewView === 'ai' ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => setPreviewView('ai')}
          >
            AI Output
          </Button>
        </div>
      </div>
      <div
        className={
          isPreviewFullscreen
            ? 'fixed inset-0 z-50 bg-black flex flex-col'
            : 'aspect-video w-full bg-muted rounded-md overflow-hidden relative'
        }
      >
        <div
          className={
            isPreviewFullscreen ? 'flex-1 min-h-0 relative' : 'absolute inset-0'
          }
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full absolute inset-0 ${isPreviewFullscreen ? 'object-contain' : 'object-cover'}`}
            style={{ display: previewView === 'camera' ? 'block' : 'none' }}
            aria-hidden
          />
          <video
            ref={player.videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full absolute inset-0 ${isPreviewFullscreen ? 'object-contain' : 'object-cover'}`}
            style={{ display: previewView === 'ai' ? 'block' : 'none' }}
            aria-hidden
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ visibility: 'hidden' }} aria-hidden />
        </div>
        {!isPreviewFullscreen && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2 z-10 h-10 w-10 rounded-full shadow-md min-h-[44px] min-w-[44px]"
            onClick={() => setIsPreviewFullscreen(true)}
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-5 h-5" />
          </Button>
        )}
        {isPreviewFullscreen && (
          <div
            className="flex items-center justify-between gap-3 px-3 py-3 border-t border-border bg-background/95 flex-shrink-0"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] min-w-[44px] shrink-0"
              onClick={() => setIsPreviewFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <Minimize className="w-5 h-5" />
            </Button>
            {!isRecording ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-12 w-12 rounded-full shrink-0 min-h-[44px] min-w-[44px]"
                aria-label="Record"
                onClick={() => {
                  if (includeTimelineAudio) {
                    usePlaybackStore.getState().play();
                  }
                  setRecording(true);
                }}
              >
                <Circle className="w-6 h-6 fill-current" />
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px] shrink-0"
                aria-label="Stop recording"
                onClick={() => setRecording(false)}
              >
                Stop
              </Button>
            )}
          </div>
        )}
      </div>
      {outputWhepUrlError && (
        <p className="text-xs text-destructive mt-1">{outputWhepUrlError}</p>
      )}
      {isSd15 && outputWhepUrl && player.status.state !== 'playing' && (
        <p className="text-xs text-muted-foreground mt-1">
          First frame may take 60–90 seconds for this model.
        </p>
      )}
      {showColdStartTimeoutMessage && (
        <p className="text-xs text-muted-foreground mt-1">
          Still waiting for video.{' '}
          <a
            href={DAYDREAM_API_LOGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Check API Logs
          </a>{' '}
          if the issue continues.
        </p>
      )}
      {isDaydreamStream && streamStatus && player.status.state !== 'playing' && (
        <p className="text-xs text-muted-foreground mt-1">
          {streamStatus.success
            ? 'Stream starting…'
            : streamStatus.error
              ? `Status: ${streamStatus.error}`
              : 'Stream starting…'}{' '}
          <a
            href={DAYDREAM_API_LOGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            API Logs
          </a>
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        Broadcast: {broadcast.status.state} · Player: {player.status.state}
      </p>
    </>
  );
}

/** Wrapper that runs the billing loop; only mount when user has a connected account (avoids useSmartAccountClient when undefined). */
function LiveAISessionWithBroadcastWithBilling(props: LiveAISessionWithBroadcastProps) {
  const { setOnPause } = useBillingLoop();
  return (
    <LiveAISessionWithBroadcastCore
      {...props}
      setOnPause={setOnPause}
      billingEnabled
    />
  );
}

/** Catches errors from useSmartAccountClient (e.g. context undefined) and falls back to session without billing. */
class LiveAISessionBillingErrorBoundary extends Component<
  { sessionProps: LiveAISessionWithBroadcastProps; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <LiveAISessionWithBroadcastCore
          {...this.props.sessionProps}
          setOnPause={noopSetOnPause}
          billingEnabled={false}
        />
      );
    }
    return this.props.children;
  }
}

export function LiveAIPopover() {
  return <LiveAIPopoverFloating />;
}
