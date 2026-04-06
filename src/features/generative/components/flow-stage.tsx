import { memo, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '@/shared/logging/logger';
import { NodeStart } from './node-start';
import { NodeBridge } from './node-bridge';
import { NodeEnd } from './node-end';
import { RenderControls } from './render-controls';
import { ClipBin, type ClipBinEntry } from './clip-bin';
import { useLiveSessionStore } from '../deps/live-ai';
import { useGenerativeStore } from '../stores/generative-store';

const logger = createLogger('FlowStage');

/** Default recording duration in milliseconds. */
const DEFAULT_RENDER_DURATION_MS = 10_000;
/** MediaRecorder data collection interval. */
const TIMESLICE_MS = 250;

/**
 * Determine the best supported video MIME type for MediaRecorder.
 */
function getSupportedMimeType(): string {
  const candidates = [
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

/**
 * Generate a thumbnail from the first frame of a video blob.
 */
async function generateThumbnail(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    video.addEventListener('loadeddata', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, 320, 180);
      }
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    }, { once: true });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      // Return a transparent pixel as fallback
      resolve('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    }, { once: true });

    video.load();
  });
}

/**
 * Flow Keyframe Stage (Zone 2).
 * Three-node horizontal layout: Start Image -> Generative Bridge -> End Image.
 * Displayed as an alternative to the standard program monitor.
 */
export const FlowStage = memo(function FlowStage() {
  const scopeSession = useLiveSessionStore((s) => s.scopeSession);
  const pipelineLoading = useLiveSessionStore((s) => s.pipelineLoading);
  const remoteStream = scopeSession?.remoteStream ?? null;

  const startImage = useGenerativeStore((s) => s.startImage);
  const renderStatus = useGenerativeStore((s) => s.renderStatus);
  const pipelineReady = useGenerativeStore((s) => s.pipelineReady);
  const clips = useGenerativeStore((s) => s.clips);
  const setPipelineReady = useGenerativeStore((s) => s.setPipelineReady);
  const setRenderStatus = useGenerativeStore((s) => s.setRenderStatus);
  const setRenderProgress = useGenerativeStore((s) => s.setRenderProgress);
  const setRenderError = useGenerativeStore((s) => s.setRenderError);
  const addClip = useGenerativeStore((s) => s.addClip);
  const removeClip = useGenerativeStore((s) => s.removeClip);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Fix 1: Sync pipelineReady with Scope session state ---
  useEffect(() => {
    const hasStream = remoteStream !== null;
    setPipelineReady(hasStream && !pipelineLoading);

    // Sync render status with pipeline state (only when not actively rendering)
    const currentStatus = useGenerativeStore.getState().renderStatus;
    if (currentStatus === 'rendering') return;

    if (pipelineLoading) {
      setRenderStatus('loading-pipeline');
    } else if (currentStatus === 'loading-pipeline') {
      // Pipeline finished loading, return to idle
      setRenderStatus('idle');
    }
  }, [remoteStream, pipelineLoading, setPipelineReady, setRenderStatus]);

  // --- Fix 2: Implement onRender handler with MediaRecorder ---
  const handleRender = useCallback(async () => {
    if (!remoteStream) {
      logger.warn('Cannot render: no remote stream available');
      return;
    }

    const mimeType = getSupportedMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(remoteStream, { mimeType });
    } catch (error) {
      logger.error('Failed to create MediaRecorder', error);
      setRenderError('MediaRecorder not supported for this stream');
      setRenderStatus('error');
      return;
    }

    const chunks: Blob[] = [];
    const startTime = Date.now();

    setRenderStatus('rendering');
    setRenderProgress(0);
    setRenderError(null);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      recorderRef.current = null;

      if (chunks.length === 0) {
        setRenderStatus('error');
        setRenderError('No data was recorded');
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const durationMs = Date.now() - startTime;

      try {
        const thumbnailUrl = await generateThumbnail(blob);

        const clip: ClipBinEntry = {
          id: crypto.randomUUID(),
          blob,
          thumbnailUrl,
          durationMs,
          createdAt: Date.now(),
        };

        addClip(clip);
        setRenderProgress(1);
        setRenderStatus('complete');

        logger.info('Render complete', { clipId: clip.id, durationMs, blobSize: blob.size });

        // Auto-reset to idle after a brief delay so the user sees "complete"
        setTimeout(() => {
          const current = useGenerativeStore.getState().renderStatus;
          if (current === 'complete') {
            setRenderStatus('idle');
          }
        }, 2000);
      } catch (error) {
        logger.error('Failed to finalize render', error);
        setRenderStatus('error');
        setRenderError('Failed to process recorded video');
      }
    };

    recorder.onerror = () => {
      recorderRef.current = null;
      setRenderStatus('error');
      setRenderError('Recording failed');
    };

    recorderRef.current = recorder;
    recorder.start(TIMESLICE_MS);

    // Progress ticker
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / DEFAULT_RENDER_DURATION_MS, 0.99);
      setRenderProgress(progress);
    }, 200);

    // Auto-stop after duration
    renderTimerRef.current = setTimeout(() => {
      clearInterval(progressInterval);
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, DEFAULT_RENDER_DURATION_MS);

    // Cleanup on unmount
    return () => {
      clearInterval(progressInterval);
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
      }
    };
  }, [remoteStream, setRenderStatus, setRenderProgress, setRenderError, addClip]);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
      }
    };
  }, []);

  const handleRemoveClip = useCallback((id: string) => {
    removeClip(id);
  }, [removeClip]);

  // --- Fix 6: Contextual guidance text ---
  const guidanceText = getGuidanceText({
    hasStartImage: startImage !== null,
    hasStream: remoteStream !== null,
    pipelineLoading,
    pipelineReady,
    renderStatus,
    hasClips: clips.length > 0,
  });

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background p-4">
      {/* Three-node horizontal layout */}
      <div className="flex items-center gap-4">
        {/* Node A: Start Image */}
        <NodeStart />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Node B: Generative Bridge */}
        <NodeBridge remoteStream={remoteStream} />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Node C: End Image (Optional) */}
        <NodeEnd />
      </div>

      {/* Render controls */}
      <RenderControls onRender={handleRender} />

      {/* Guidance text */}
      {guidanceText && (
        <p className="text-xs text-muted-foreground">{guidanceText}</p>
      )}

      {/* Clip Bin */}
      {clips.length > 0 && (
        <div className="w-full max-w-lg">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Rendered Clips</span>
          <ClipBin clips={clips} onRemoveClip={handleRemoveClip} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Drag clips to the timeline to add them to your project
          </p>
        </div>
      )}
    </div>
  );
});

function getGuidanceText(state: {
  hasStartImage: boolean;
  hasStream: boolean;
  pipelineLoading: boolean;
  pipelineReady: boolean;
  renderStatus: string;
  hasClips: boolean;
}): string | null {
  if (state.renderStatus === 'rendering') return null;
  if (state.renderStatus === 'complete') return 'Clip rendered! Drag it from the Clip Bin to the timeline.';
  if (state.renderStatus === 'error') return 'Render failed. Check the AI pipeline connection and try again.';

  if (!state.hasStartImage) {
    return 'Drop or click to add a Start Image, or use Capture to grab the current preview frame.';
  }
  if (state.pipelineLoading) {
    return 'Loading AI pipeline...';
  }
  if (!state.hasStream) {
    return 'Open the AI sidebar to connect to Scope and start the pipeline.';
  }
  if (state.pipelineReady) {
    return 'Pipeline ready! Click Render Video to capture the AI output.';
  }
  return null;
}
