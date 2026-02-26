/**
 * Canvas Render Orchestrator
 *
 * Top-level entry points that drive the full render pipeline:
 * - {@link renderComposition} – renders a full video composition (video + audio)
 * - {@link renderAudioOnly}  – encodes only the audio tracks
 * - {@link renderSingleFrame} – renders one frame to a Blob (thumbnails)
 *
 * These functions set up the mediabunny encoder, call into
 * {@link createCompositionRenderer} for per-frame rendering, and handle
 * progress reporting and cancellation.
 */

import type { CompositionInputProps } from '@/types/export';
import type { TimelineTrack, TimelineItem, VideoItem } from '@/types/timeline';
import type { ClientExportSettings, RenderProgress, ClientRenderResult } from './client-renderer';
import { createOutputFormat, getMimeType } from './client-renderer';
import { createLogger } from '@/lib/logger';

// Subsystems
import { processAudio, createAudioBuffer, hasAudioContent, clearAudioDecodeCache } from './canvas-audio';
import { createCompositionRenderer } from './client-render-engine';

const log = createLogger('CanvasRenderOrchestrator');
let ac3DecoderRegistered = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Type for mediabunny module (dynamically imported)
type MediabunnyModule = typeof import('mediabunny');

export interface RenderEngineOptions {
  settings: ClientExportSettings;
  composition: CompositionInputProps;
  onProgress: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

interface AudioRenderOptions {
  settings: ClientExportSettings;
  composition: CompositionInputProps;
  onProgress: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

interface SingleFrameOptions {
  composition: CompositionInputProps;
  frame: number;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface PacketRemuxPlan {
  src: string;
  trimStartSeconds: number;
  trimEndSeconds: number;
  includeAudio: boolean;
}

const EPSILON = 1e-6;

function isIdentityTransform(item: VideoItem): boolean {
  const transform = item.transform;
  if (!transform) return true;

  if (transform.width !== undefined || transform.height !== undefined) return false;
  if (transform.x !== undefined && Math.abs(transform.x) > EPSILON) return false;
  if (transform.y !== undefined && Math.abs(transform.y) > EPSILON) return false;
  if (transform.rotation !== undefined && Math.abs(transform.rotation) > EPSILON) return false;
  if (transform.cornerRadius !== undefined && Math.abs(transform.cornerRadius) > EPSILON) return false;
  if (transform.opacity !== undefined && Math.abs(transform.opacity - 1) > EPSILON) return false;
  return true;
}

function getPacketRemuxPlan(
  settings: ClientExportSettings,
  composition: CompositionInputProps
): PacketRemuxPlan | null {
  if (settings.mode !== 'video') return null;
  if (composition.durationInFrames === undefined || composition.durationInFrames <= 0) return null;
  if ((composition.transitions?.length ?? 0) > 0) return null;
  if ((composition.keyframes?.length ?? 0) > 0) return null;

  const tracks: TimelineTrack[] = (composition.tracks ?? []).filter((track) => track.visible !== false);
  const items: Array<{ item: TimelineItem; track: TimelineTrack }> = [];

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.durationInFrames > 0) {
        items.push({ item, track });
      }
    }
  }

  if (items.length !== 1) return null;

  const { item, track } = items[0]!;
  if (item.type !== 'video') return null;

  const videoItem = item as VideoItem;
  if (!videoItem.src) return null;
  if (videoItem.from !== 0) return null;
  if (videoItem.durationInFrames !== composition.durationInFrames) return null;
  if ((videoItem.effects?.length ?? 0) > 0) return null;
  if (!isIdentityTransform(videoItem)) return null;

  const speed = videoItem.speed ?? 1;
  if (Math.abs(speed - 1) > EPSILON) return null;

  const hasVisualFades = Math.abs(videoItem.fadeIn ?? 0) > EPSILON
    || Math.abs(videoItem.fadeOut ?? 0) > EPSILON;
  if (hasVisualFades) return null;

  const includeAudio = track.muted !== true;
  if (includeAudio) {
    const hasAudioAdjustments = Math.abs(videoItem.volume ?? 0) > EPSILON
      || Math.abs(videoItem.audioFadeIn ?? 0) > EPSILON
      || Math.abs(videoItem.audioFadeOut ?? 0) > EPSILON;
    if (hasAudioAdjustments) return null;
  }

  const sourceFps = videoItem.sourceFps ?? composition.fps;
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) return null;
  if (Math.abs((settings.fps ?? composition.fps) - composition.fps) > EPSILON) return null;

  // Require clip to start at source frame 0 — a trimmed-from-middle clip can't be
  // remuxed directly and must fall back to frame-by-frame rendering.
  const sourceStartFrames = videoItem.sourceStart ?? videoItem.trimStart ?? videoItem.offset ?? 0;
  if (Math.abs(sourceStartFrames) > EPSILON) return null;
  const trimStartSeconds = Math.max(0, sourceStartFrames / sourceFps);
  const clipDurationSeconds = videoItem.durationInFrames / composition.fps;
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return null;

  const trimEndSeconds = trimStartSeconds + clipDurationSeconds;
  if (!Number.isFinite(trimEndSeconds) || trimEndSeconds <= trimStartSeconds) return null;

  return {
    src: videoItem.src,
    trimStartSeconds,
    trimEndSeconds,
    includeAudio,
  };
}

async function tryPacketRemuxComposition(options: RenderEngineOptions): Promise<ClientRenderResult | null> {
  const { settings, composition, onProgress, signal } = options;
  const durationInFrames = composition.durationInFrames ?? 0;
  const fps = composition.fps;
  const durationSeconds = durationInFrames / Math.max(fps, 1);

  const plan = getPacketRemuxPlan(settings, composition);
  if (!plan) return null;
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError');
  }

  const mediabunny: MediabunnyModule = await import('mediabunny');
  const { Input, UrlSource, Output, BufferTarget, Conversion, ALL_FORMATS } = mediabunny;

  const format = await createOutputFormat(settings.container, { fastStart: true }) as {
    getSupportedVideoCodecs?: () => string[];
    getSupportedAudioCodecs?: () => string[];
  };

  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(plan.src),
  });

  let conversion: {
    cancel: () => Promise<void>;
    isValid: boolean;
    onProgress?: (progress: number) => unknown;
    execute: () => Promise<void>;
  } | null = null;
  const cancelConversion = () => {
    if (!conversion) return;
    void conversion.cancel().catch(() => undefined);
  };

  signal?.addEventListener('abort', cancelConversion, { once: true });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack?.codec) {
      return null;
    }

    const supportedVideoCodecs = format.getSupportedVideoCodecs?.() ?? [];
    if (!supportedVideoCodecs.includes(videoTrack.codec) || videoTrack.codec !== settings.codec) {
      return null;
    }

    if (
      videoTrack.displayWidth !== settings.resolution.width
      || videoTrack.displayHeight !== settings.resolution.height
    ) {
      return null;
    }

    if (plan.includeAudio) {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack?.codec) {
        const supportedAudioCodecs = format.getSupportedAudioCodecs?.() ?? [];
        if (!supportedAudioCodecs.includes(audioTrack.codec)) {
          return null;
        }
      }
    }

    onProgress({
      phase: 'preparing',
      progress: 5,
      totalFrames: durationInFrames,
      message: 'Preparing packet remux...',
    });

    // Create output resources only after all validation checks pass.
    const target = new BufferTarget();
    const output = new Output({
      format: format as unknown as ConstructorParameters<typeof Output>[0]['format'],
      target,
    });

    try {
      conversion = await Conversion.init({
        input,
        output,
        trim: {
          start: plan.trimStartSeconds,
          end: plan.trimEndSeconds,
        },
        video: {
          codec: settings.codec,
          forceTranscode: false,
        },
        audio: plan.includeAudio
          ? { forceTranscode: false }
          : { discard: true },
        showWarnings: false,
      });

      if (!conversion.isValid) {
        return null;
      }

      conversion.onProgress = (progress: number) => {
        const clamped = Math.max(0, Math.min(1, progress));
        onProgress({
          phase: 'encoding',
          progress: Math.round(clamped * 90),
          currentFrame: Math.round(clamped * durationInFrames),
          totalFrames: durationInFrames,
          message: 'Remuxing packets...',
        });
      };

      await conversion.execute();

      const buffer = target.buffer;
      if (!buffer) {
        throw new Error('No output buffer generated');
      }

      const blob = new Blob([buffer], { type: getMimeType(settings.container, settings.codec) });

      onProgress({
        phase: 'finalizing',
        progress: 100,
        currentFrame: durationInFrames,
        totalFrames: durationInFrames,
        message: 'Complete!',
      });

      log.info('Packet remux export completed', {
        durationSeconds,
        fileSize: blob.size,
        container: settings.container,
        codec: settings.codec,
        includeAudio: plan.includeAudio,
      });

      return {
        blob,
        mimeType: getMimeType(settings.container, settings.codec),
        duration: durationSeconds,
        fileSize: blob.size,
      };
    } finally {
      (output as unknown as { dispose?: () => void }).dispose?.();
    }
  } catch (error) {
    const isCanceled = signal?.aborted
      || (error instanceof Error && error.name === 'ConversionCanceledError');
    if (isCanceled) {
      throw new DOMException('Render cancelled', 'AbortError');
    }

    log.warn('Packet remux path failed; falling back to frame render', { error });
    return null;
  } finally {
    signal?.removeEventListener('abort', cancelConversion);
    input.dispose();
  }
}

// ---------------------------------------------------------------------------
// renderComposition
// ---------------------------------------------------------------------------

/**
 * Main render function – orchestrates the entire client-side render.
 */
export async function renderComposition(options: RenderEngineOptions): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal } = options;
  const { fps, durationInFrames = 0 } = composition;

  log.info('Starting enhanced client render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    width: settings.resolution.width,
    height: settings.resolution.height,
    codec: settings.codec,
    tracksCount: composition.tracks?.length ?? 0,
    hasTransitions: (composition.transitions?.length ?? 0) > 0,
    hasKeyframes: (composition.keyframes?.length ?? 0) > 0,
  });

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration');
  }

  const totalFrames = durationInFrames;
  const durationSeconds = totalFrames / fps;

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames,
    message: 'Loading encoder...',
  });

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError');
  }

  // Fast path: when the timeline is a single unmodified clip, remux packets directly.
  const remuxResult = await tryPacketRemuxComposition(options);
  if (remuxResult) {
    return remuxResult;
  }

  // Dynamically import mediabunny + register AC-3 decoder for source audio
  const mediabunny: MediabunnyModule = await import('mediabunny');
  if (!ac3DecoderRegistered) {
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    try {
      registerAc3Decoder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already registered/i.test(message)) {
        throw err;
      }
    }
    ac3DecoderRegistered = true;
  }
  const { Output, BufferTarget, VideoSampleSource, VideoSample, AudioBufferSource } = mediabunny;

  onProgress({
    phase: 'preparing',
    progress: 5,
    totalFrames,
    message: 'Processing audio...',
  });

  // Process audio in parallel with setup
  let audioData: { samples: Float32Array[]; sampleRate: number; channels: number } | null = null;
  if (await hasAudioContent(composition)) {
    try {
      audioData = await processAudio(composition, signal);
      log.info('Audio processed', {
        hasAudio: !!audioData,
        sampleRate: audioData?.sampleRate,
        channels: audioData?.channels,
      });
    } catch (error) {
      log.error('Audio processing failed, continuing without audio', { error });
    }
  }

  onProgress({
    phase: 'preparing',
    progress: 15,
    totalFrames,
    message: 'Creating encoder...',
  });

  // Create output format
  const format = await createOutputFormat(settings.container, { fastStart: true });

  // Create buffer target to collect the output
  const target = new BufferTarget();

  // Create output
  const output = new Output({
    format,
    target,
  });

  // Get composition (project) resolution – this is what we render at
  const compositionWidth = composition.width ?? settings.resolution.width;
  const compositionHeight = composition.height ?? settings.resolution.height;

  // Export resolution – this is what we output (may be different from composition)
  const exportWidth = settings.resolution.width;
  const exportHeight = settings.resolution.height;

  // Check if we need to scale (export resolution differs from composition)
  const needsScaling = exportWidth !== compositionWidth || exportHeight !== compositionHeight;

  log.info('Resolution settings', {
    composition: { width: compositionWidth, height: compositionHeight },
    export: { width: exportWidth, height: exportHeight },
    needsScaling,
  });

  // Create canvas for rendering frames at COMPOSITION resolution
  // This ensures all positioning/transforms are calculated correctly
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight);
  // Keep default context settings to preserve hardware acceleration.
  // `willReadFrequently` can force software rendering and slow draw-heavy workloads.
  const ctx = renderCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to create OffscreenCanvas 2D context');
  }

  // Create output canvas at EXPORT resolution (for encoding)
  // If no scaling needed, we'll use renderCanvas directly
  const outputCanvas = needsScaling
    ? new OffscreenCanvas(exportWidth, exportHeight)
    : renderCanvas;
  const outputCtx = needsScaling
    ? outputCanvas.getContext('2d')!
    : ctx;

  onProgress({
    phase: 'preparing',
    progress: 20,
    totalFrames,
    message: 'Setting up video encoder...',
  });

  // Create video source for explicit frame capture (at export resolution)
  // VideoSampleSource lets us control frame capture timing precisely with VideoSample
  // Use 'quality' latencyMode to enable B-frames and better rate control for offline encoding
  const videoSource = new VideoSampleSource({
    codec: settings.codec,
    bitrate: settings.videoBitrate ?? 10_000_000,
    keyFrameInterval: 2, // Keyframe every 2 seconds for better seeking
    latencyMode: 'quality', // Enables B-frames and consistent frame quality for offline encoding
  });

  // Add video track
  output.addVideoTrack(videoSource, {
    frameRate: fps,
  });

  // Prepare audio source and buffer (stored outside try block for access after start)
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  let audioBuffer: AudioBuffer | null = null;

  if (audioData) {
    try {
      // Create audio buffer from processed samples
      audioBuffer = createAudioBuffer(audioData);

      // Select audio codec based on container
      // WebM only supports opus/vorbis, MP4 supports aac
      const audioCodec = settings.container === 'webm' ? 'opus' : 'aac';

      // Create audio source for encoding
      audioSource = new AudioBufferSource({
        codec: audioCodec,
        bitrate: settings.audioBitrate ?? 192000,
      });

      // Add audio track to output (audio data fed after start())
      output.addAudioTrack(audioSource);
      log.info('Audio track added to output', {
        duration: audioBuffer.duration,
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        codec: audioCodec,
      });
    } catch (error) {
      log.error('Failed to setup audio track', { error });
      audioSource = null;
      audioBuffer = null;
    }
  }

  // Start the output
  await output.start();

  // Feed audio buffer after output has started
  // AudioBufferSource.add() must be called after output.start()
  if (audioSource && audioBuffer) {
    try {
      await audioSource.add(audioBuffer);
      log.info('Audio buffer fed to encoder', {
        duration: audioBuffer.duration,
        samples: audioBuffer.length,
      });
    } catch (error) {
      log.error('Failed to feed audio to encoder', { error });
    }
  }

  onProgress({
    phase: 'rendering',
    progress: 0,
    currentFrame: 0,
    totalFrames,
    message: 'Rendering frames...',
  });

  // Create a composition renderer
  const frameRenderer = await createCompositionRenderer(composition, renderCanvas, ctx);

  try {
    // Preload media
    await frameRenderer.preload();

    // Render each frame using a pipelined double-buffer approach.
    // VideoSample copies pixel data on construction, so the canvas is free
    // immediately after. We overlap the previous frame's encode with the
    // next frame's render for ~25-40% throughput improvement.
    let pendingEncode: Promise<void> | null = null;

    for (let frame = 0; frame < totalFrames; frame++) {
      // Check for abort — drain any in-flight encode first so the encoder
      // is idle before we cancel the output. Discard encoder errors since
      // we are aborting anyway and must always surface AbortError.
      if (signal?.aborted) {
        if (pendingEncode) {
          try { await pendingEncode; } catch { /* discarded — aborting */ }
        }
        await output.cancel();
        throw new DOMException('Render cancelled', 'AbortError');
      }

      // Render frame to canvas first — this overlaps with the previous frame's
      // encode that is still in flight. The previous VideoSample already copied
      // its pixels, so writing to the canvas here cannot corrupt it.
      await frameRenderer.renderFrame(frame);

      // Scale to output resolution if needed
      if (needsScaling) {
        outputCtx.clearRect(0, 0, exportWidth, exportHeight);
        outputCtx.drawImage(renderCanvas, 0, 0, exportWidth, exportHeight);
      }

      // Now wait for the previous encode to finish before capturing a new
      // VideoSample. This ensures at most one encode is in flight and that
      // frames are fed to the encoder in order.
      if (pendingEncode) await pendingEncode;

      // Calculate timestamp in seconds
      const timestamp = frame / fps;
      const frameDuration = 1 / fps;

      // Snapshot canvas pixels into a VideoSample. The constructor copies
      // pixel data immediately — the canvas is free for the next render.
      const sample = new VideoSample(outputCanvas, { timestamp, duration: frameDuration });

      // Kick off encoding in the background. NOT awaited here — it runs
      // concurrently with the next iteration's renderFrame().
      const isKeyFrame = frame === 0;
      pendingEncode = (async () => {
        try {
          if (isKeyFrame) {
            await videoSource.add(sample, { keyFrame: true });
          } else {
            await videoSource.add(sample);
          }
        } finally {
          // VideoSampleSource does NOT close samples (unlike CanvasSource).
          // We must close to release the underlying VideoFrame's GPU memory,
          // otherwise the browser throttles after ~8-16 outstanding frames.
          sample.close();
        }
      })();

      // Report progress
      const progress = Math.round((frame / totalFrames) * 100);
      onProgress({
        phase: 'rendering',
        progress,
        currentFrame: frame,
        totalFrames,
        message: `Rendering frame ${frame + 1}/${totalFrames}`,
      });
    }

    // Drain the final in-flight encode before finalizing
    if (pendingEncode) await pendingEncode;

    onProgress({
      phase: 'finalizing',
      progress: 95,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Finalizing video...',
    });

    // Close audio source before finalizing (signals no more audio data)
    if (audioSource) {
      try {
        audioSource.close();
        log.info('Audio source closed');
      } catch (error) {
        log.error('Failed to close audio source', { error });
      }
    }

    // Finalize output
    await output.finalize();

    // Get the buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('No output buffer generated');
    }

    const blob = new Blob([buffer], { type: getMimeType(settings.container, settings.codec) });

    onProgress({
      phase: 'finalizing',
      progress: 100,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Complete!',
    });

    // Cleanup
    frameRenderer.dispose();
    clearAudioDecodeCache();

    return {
      blob,
      mimeType: getMimeType(settings.container, settings.codec),
      duration: durationSeconds,
      fileSize: blob.size,
    };
  } catch (error) {
    // Cleanup on error
    frameRenderer.dispose();
    clearAudioDecodeCache();

    // Attempt to cancel the output on error
    try {
      if (output.state === 'started') {
        await output.cancel();
      }
    } catch {
      // Ignore cancel errors
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// renderSingleFrame
// ---------------------------------------------------------------------------

/**
 * Render a single frame from a composition to a Blob.
 * Reuses the same createCompositionRenderer as full export for consistency.
 * Includes all layers: video, images, text, shapes, effects, transitions.
 */
export async function renderSingleFrame(options: SingleFrameOptions): Promise<Blob> {
  const {
    composition,
    frame,
    width = 320,
    height = 180,
    quality = 0.85,
    format = 'image/jpeg',
  } = options;

  const compositionWidth = composition.width || 1920;
  const compositionHeight = composition.height || 1080;

  log.debug('Rendering single frame', { frame, width, height, compositionWidth, compositionHeight });

  // Create canvas at full composition size
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight);
  const renderCtx = renderCanvas.getContext('2d');
  if (!renderCtx) {
    throw new Error('Failed to get 2d context');
  }

  // Use the SAME renderer as export – single source of truth
  const renderer = await createCompositionRenderer(composition, renderCanvas, renderCtx);
  try {
    await renderer.preload();
    await renderer.renderFrame(frame);

    // Scale down to thumbnail size
    const thumbnailCanvas = new OffscreenCanvas(width, height);
    const thumbnailCtx = thumbnailCanvas.getContext('2d');
    if (!thumbnailCtx) {
      throw new Error('Failed to get thumbnail 2d context');
    }

    thumbnailCtx.drawImage(renderCanvas, 0, 0, width, height);

    const blob = await thumbnailCanvas.convertToBlob({ type: format, quality });
    return blob;
  } finally {
    try {
      renderer.dispose();
    } catch (error) {
      log.warn('Failed to dispose single-frame renderer', { error });
    }
  }
}

// ---------------------------------------------------------------------------
// renderAudioOnly
// ---------------------------------------------------------------------------

/**
 * Render audio-only export (no video frames).
 * Extracts and mixes all audio from the composition and encodes to the specified format.
 */
export async function renderAudioOnly(options: AudioRenderOptions): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal } = options;
  const { fps, durationInFrames = 0 } = composition;

  log.info('Starting audio-only render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    container: settings.container,
    audioCodec: settings.audioCodec,
    audioBitrate: settings.audioBitrate,
  });

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration');
  }

  const durationSeconds = durationInFrames / fps;

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames: durationInFrames,
    message: 'Loading encoder...',
  });

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError');
  }

  // Dynamically import mediabunny + register AC-3 decoder for source audio
  const mediabunny = await import('mediabunny');
  if (!ac3DecoderRegistered) {
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    try {
      registerAc3Decoder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already registered/i.test(message)) {
        throw err;
      }
    }
    ac3DecoderRegistered = true;
  }
  const { Output, BufferTarget, AudioBufferSource } = mediabunny;

  // Register MP3 encoder if exporting to MP3
  if (settings.container === 'mp3') {
    try {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
      registerMp3Encoder();
      log.info('MP3 encoder registered');
    } catch (err) {
      log.warn('Failed to load MP3 encoder extension', err);
    }
  }

  onProgress({
    phase: 'preparing',
    progress: 10,
    totalFrames: durationInFrames,
    message: 'Processing audio...',
  });

  // Process audio
  if (!(await hasAudioContent(composition))) {
    throw new Error('No audio content found in composition');
  }

  const audioData = await processAudio(composition, signal);
  if (!audioData) {
    throw new Error('Failed to process audio');
  }

  onProgress({
    phase: 'preparing',
    progress: 50,
    totalFrames: durationInFrames,
    message: 'Creating encoder...',
  });

  // Create output format
  const format = await createOutputFormat(settings.container, { fastStart: true });

  // Create buffer target to collect the output
  const target = new BufferTarget();

  // Create output
  const output = new Output({
    format,
    target,
  });

  // Determine audio codec based on container (container = codec for audio-only)
  let audioCodec: 'mp3' | 'aac' | 'pcm-s16';
  switch (settings.container) {
    case 'mp3':
      audioCodec = 'mp3';
      break;
    case 'aac':
      audioCodec = 'aac';
      break;
    default:
      audioCodec = 'pcm-s16';
  }

  // PCM codecs don't need browser encoding support – they're raw samples
  const isPcmCodec = audioCodec === 'pcm-s16';

  if (!isPcmCodec) {
    // Check if codec is supported
    const { canEncodeAudio } = mediabunny;
    const isSupported = await canEncodeAudio(audioCodec, {
      bitrate: settings.audioBitrate ?? 192000,
      numberOfChannels: 2,
      sampleRate: 48000,
    });

    if (!isSupported) {
      throw new Error(
        `${audioCodec.toUpperCase()} encoding is not supported in this browser. ` +
        `Try exporting as WAV (lossless) instead.`
      );
    }
    log.info(`Using ${audioCodec.toUpperCase()} codec`);
  }

  // Create audio buffer from processed samples
  const audioBuffer = createAudioBuffer(audioData);

  // Create audio source for encoding
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    bitrate: settings.audioBitrate ?? 192000,
  });

  // Add audio track to output
  output.addAudioTrack(audioSource);

  log.info('Audio track configured', {
    duration: audioBuffer.duration,
    channels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
    codec: audioCodec,
  });

  onProgress({
    phase: 'encoding',
    progress: 60,
    totalFrames: durationInFrames,
    message: 'Encoding audio...',
  });

  // Start the output
  await output.start();

  // Feed audio buffer
  await audioSource.add(audioBuffer);

  onProgress({
    phase: 'finalizing',
    progress: 90,
    totalFrames: durationInFrames,
    message: 'Finalizing audio...',
  });

  // Close audio source
  audioSource.close();

  // Finalize output
  await output.finalize();

  // Get the buffer
  const buffer = target.buffer;
  if (!buffer) {
    throw new Error('No output buffer generated');
  }

  const blob = new Blob([buffer], { type: getMimeType(settings.container) });

  onProgress({
    phase: 'finalizing',
    progress: 100,
    totalFrames: durationInFrames,
    message: 'Complete!',
  });

  return {
    blob,
    mimeType: getMimeType(settings.container),
    duration: durationSeconds,
    fileSize: blob.size,
  };
}
