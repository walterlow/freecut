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
import type { ClientExportSettings, RenderProgress, ClientRenderResult } from './client-renderer';
import { createOutputFormat, getMimeType } from './client-renderer';
import { createLogger } from '@/lib/logger';

// Subsystems
import { processAudio, createAudioBuffer, hasAudioContent, clearAudioDecodeCache } from './canvas-audio';
import { createCompositionRenderer } from './client-render-engine';

const log = createLogger('CanvasRenderOrchestrator');

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

  // Dynamically import mediabunny + register AC-3 decoder for source audio
  const mediabunny: MediabunnyModule = await import('mediabunny');
  const { registerAc3Decoder } = await import('@mediabunny/ac3');
  registerAc3Decoder();
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

    // Render each frame
    for (let frame = 0; frame < totalFrames; frame++) {
      // Check for abort
      if (signal?.aborted) {
        await output.cancel();
        throw new DOMException('Render cancelled', 'AbortError');
      }

      // Render frame to canvas (at composition resolution)
      await frameRenderer.renderFrame(frame);

      // Scale to output resolution if needed
      if (needsScaling) {
        // Clear output canvas and draw scaled version
        outputCtx.clearRect(0, 0, exportWidth, exportHeight);
        outputCtx.drawImage(renderCanvas, 0, 0, exportWidth, exportHeight);
      }

      // Calculate timestamp in seconds
      const timestamp = frame / fps;
      const frameDuration = 1 / fps;

      // Explicitly snapshot canvas pixels into a VideoSample
      // VideoSample constructor copies pixel data immediately, preventing any race
      const sample = new VideoSample(outputCanvas, { timestamp, duration: frameDuration });

      // Add frame to video source, then release GPU memory
      // Force first frame to be a keyframe to ensure proper GOP structure
      // IMPORTANT: Must await to ensure frames are processed in order
      try {
        if (frame === 0) {
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
  const { registerAc3Decoder } = await import('@mediabunny/ac3');
  registerAc3Decoder();
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
