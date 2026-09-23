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

import type { CompositionInputProps } from '@/types/export'
import type { ClientExportSettings, RenderProgress, ClientRenderResult } from './client-renderer'
import { createOutputFormat, getMimeType } from './client-renderer'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import { createLogger } from '@/shared/logging/logger'
import { ensureAudioEncoderSupport } from '@/shared/media/audio-encoder-support'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  getPacketRemuxPlan,
  isRemuxEligibleSourceAudio,
  isRemuxEligibleSourceVideo,
} from './packet-remux-plan'
import { createExportOutputTarget } from './export-output-target'
import {
  resolveAudioOnlyCodec,
  resolveMuxedAudioCodec,
  resolveRenderScalePlan,
  resolveTranscriptSubtitleExport,
  shouldUseWindowedAudioProcessing,
  summarizeCompositionForRender,
} from './render-export-policy'

// Subsystems
import { createCompositionRenderer } from './client-render-engine'
import { runPipelinedFrameLoop } from './pipelined-frame-loop'

function getLog() {
  return createLogger('CanvasRenderOrchestrator')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Type for mediabunny module (dynamically imported)
type MediabunnyModule = typeof import('mediabunny')
type CanvasAudioModule = typeof import('./canvas-audio')

let canvasAudioModulePromise: Promise<CanvasAudioModule> | null = null

async function loadCanvasAudio(): Promise<CanvasAudioModule> {
  if (!canvasAudioModulePromise) {
    canvasAudioModulePromise = import('./canvas-audio')
  }
  return canvasAudioModulePromise
}

const AUDIO_ENCODE_CHUNK_FRAMES = 48_000

function formatClock(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

async function addAudioDataInChunks(
  audioSource: InstanceType<MediabunnyModule['AudioSampleSource']>,
  AudioSample: MediabunnyModule['AudioSample'],
  audioData: { samples: Float32Array[]; sampleRate: number; channels: number },
  signal?: AbortSignal,
  startTimestamp = 0,
  onFramesAdded?: (frames: number) => void,
): Promise<void> {
  const totalFrames = audioData.samples[0]?.length ?? 0

  for (let offset = 0; offset < totalFrames; offset += AUDIO_ENCODE_CHUNK_FRAMES) {
    if (signal?.aborted) throw new DOMException('Audio encoding cancelled', 'AbortError')

    const frameCount = Math.min(AUDIO_ENCODE_CHUNK_FRAMES, totalFrames - offset)
    const planar = new Float32Array(frameCount * audioData.channels)
    for (let channel = 0; channel < audioData.channels; channel++) {
      const samples = audioData.samples[channel]
      if (samples) planar.set(samples.subarray(offset, offset + frameCount), channel * frameCount)
    }

    const sample = new AudioSample({
      data: planar,
      format: 'f32-planar',
      numberOfChannels: audioData.channels,
      sampleRate: audioData.sampleRate,
      timestamp: startTimestamp + offset / audioData.sampleRate,
    })
    try {
      await audioSource.add(sample)
      onFramesAdded?.(frameCount)
    } finally {
      sample.close()
    }
  }
}

async function addCompositionAudio(params: {
  audioSource: InstanceType<MediabunnyModule['AudioSampleSource']>
  AudioSample: MediabunnyModule['AudioSample']
  canvasAudio: CanvasAudioModule
  composition: CompositionInputProps
  useWindowedAudio: boolean
  signal?: AbortSignal
  onProgress?: (encodedFrames: number) => void
}): Promise<number> {
  const { audioSource, AudioSample, canvasAudio, composition, signal, onProgress } = params
  let encodedFrames = 0
  const recordFrames = (frames: number) => {
    encodedFrames += frames
    onProgress?.(encodedFrames)
  }
  if (params.useWindowedAudio) {
    for await (const window of canvasAudio.processAudioWindows(composition, signal)) {
      await addAudioDataInChunks(
        audioSource,
        AudioSample,
        window,
        signal,
        encodedFrames / window.sampleRate,
        recordFrames,
      )
    }
    return encodedFrames
  }

  const audioData = await canvasAudio.processAudio(composition, signal)
  if (!audioData) return 0
  await addAudioDataInChunks(audioSource, AudioSample, audioData, signal, 0, recordFrames)
  return encodedFrames
}

interface PreparedAudioPacketCopy {
  input: InstanceType<MediabunnyModule['Input']>
  track: NonNullable<
    Awaited<ReturnType<InstanceType<MediabunnyModule['Input']>['getPrimaryAudioTrack']>>
  >
  source: InstanceType<MediabunnyModule['EncodedAudioPacketSource']>
  durationSeconds: number
}

async function prepareAudioPacketCopy(params: {
  mediabunny: MediabunnyModule
  canvasAudio: CanvasAudioModule
  composition: CompositionInputProps
  supportedCodecs: readonly string[]
}): Promise<PreparedAudioPacketCopy | null> {
  const plan = params.canvasAudio.getAudioPacketPassthroughPlan(params.composition)
  if (!plan) return null

  const { mediabunny } = params
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: createMediabunnyInputSource(mediabunny, plan.src),
  })
  let ownershipTransferred = false
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const codec = await track.getCodec()
    const firstTimestamp = await track.getFirstTimestamp()
    if (!codec || !params.supportedCodecs.includes(codec) || Math.abs(firstTimestamp) > 0.001) {
      return null
    }
    const prepared = {
      input,
      track,
      source: new mediabunny.EncodedAudioPacketSource(codec),
      durationSeconds: plan.durationSeconds,
    }
    ownershipTransferred = true
    return prepared
  } catch (error) {
    getLog().warn('Audio packet-copy preflight failed; audio will be re-encoded', { error })
    return null
  } finally {
    if (!ownershipTransferred) input.dispose()
  }
}

async function feedAudioPacketCopy(params: {
  mediabunny: MediabunnyModule
  prepared: PreparedAudioPacketCopy
  signal?: AbortSignal
  onProgress?: (seconds: number) => void
}): Promise<void> {
  const { mediabunny, prepared, signal, onProgress } = params
  try {
    const sink = new mediabunny.EncodedPacketSink(prepared.track)
    const decoderConfig = await prepared.track.getDecoderConfig()
    const metadata = { decoderConfig: decoderConfig ?? undefined }
    for await (const packet of sink.packets()) {
      if (signal?.aborted) throw new DOMException('Audio copy cancelled', 'AbortError')
      if (packet.timestamp >= prepared.durationSeconds) break
      const copiedPacket = packet.clone({ timestamp: packet.timestamp })
      await prepared.source.add(copiedPacket, metadata)
      onProgress?.(Math.min(prepared.durationSeconds, packet.timestamp + packet.duration))
    }
  } finally {
    try {
      prepared.source.close()
    } finally {
      prepared.input.dispose()
    }
  }
}

async function registerMp3EncoderIfNeeded(container: ClientExportSettings['container']) {
  if (container !== 'mp3') return
  try {
    const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder')
    registerMp3Encoder()
    getLog().info('MP3 encoder registered')
  } catch (error) {
    getLog().warn('Failed to load MP3 encoder extension', error)
  }
}

async function assertAudioOnlyEncoderSupported(
  codec: 'mp3' | 'aac' | 'pcm-s16',
  bitrate: number,
): Promise<void> {
  if (codec === 'pcm-s16') return
  const supported = await ensureAudioEncoderSupport(codec, {
    bitrate,
    numberOfChannels: 2,
    sampleRate: 48_000,
  })
  if (!supported) {
    throw new Error(
      `${codec.toUpperCase()} encoding is not supported in this browser. ` +
        'Try exporting as WAV (lossless) instead.',
    )
  }
  getLog().info(`Using ${codec.toUpperCase()} codec`)
}

/**
 * Build the encoded audio track for a video export: pick the container's
 * muxable codec, confirm this browser can encode it, then construct and
 * register the sample source. The caller keeps ownership of the output target,
 * so a failure here just throws into its existing discard-and-rethrow handling.
 */
async function addEncodedAudioTrack(params: {
  output: InstanceType<MediabunnyModule['Output']>
  AudioSampleSource: MediabunnyModule['AudioSampleSource']
  settings: ClientExportSettings
  durationSeconds: number
  useWindowedAudio: boolean
}): Promise<InstanceType<MediabunnyModule['AudioSampleSource']>> {
  const { output, AudioSampleSource, settings, durationSeconds, useWindowedAudio } = params

  // Select the container-compatible audio codec for the muxer.
  const audioCodec = resolveMuxedAudioCodec(settings.container)
  const supported = await ensureAudioEncoderSupport(audioCodec, {
    bitrate: settings.audioBitrate ?? 192_000,
    numberOfChannels: 2,
    sampleRate: 48_000,
  })
  if (!supported) {
    throw new Error(
      `${audioCodec.toUpperCase()} audio encoding is not supported in this browser. ` +
        'Choose WebM or MKV with Opus audio.',
    )
  }

  // Create audio source for encoding
  const audioSource = new AudioSampleSource({
    codec: audioCodec,
    bitrate: settings.audioBitrate ?? 192000,
  })

  // Add audio track to output (audio data fed after start())
  output.addAudioTrack(audioSource)
  getLog().info('Audio track added to output', {
    duration: durationSeconds,
    channels: 2,
    sampleRate: 48_000,
    codec: audioCodec,
    windowed: useWindowedAudio,
  })

  return audioSource
}

/**
 * Encode-phase reporting for the audio task. Audio and video advance together,
 * so once frames start rendering the audio phases stop being worth reporting.
 */
function createAudioProgressReporter(params: {
  onProgress: (progress: RenderProgress) => void
  totalFrames: number
  durationSeconds: number
  hasVideoRenderingStarted: () => boolean
}): (completedSeconds: number, mode: 'copying' | 'processing') => void {
  const { onProgress, totalFrames, durationSeconds, hasVideoRenderingStarted } = params

  return (completedSeconds, mode) => {
    if (hasVideoRenderingStarted()) return
    const boundedSeconds = Math.min(durationSeconds, completedSeconds)
    const progress = 20 + Math.round((boundedSeconds / durationSeconds) * 15)
    onProgress({
      phase: 'preparing',
      progress,
      totalFrames,
      message: `${mode === 'copying' ? 'Copying' : 'Processing'} audio ${formatClock(boundedSeconds)} / ${formatClock(durationSeconds)}`,
    })
  }
}

/**
 * Register the soft (muxed) transcript subtitle track and hand it back so the
 * caller can flush the WebVTT payload after `output.start()`.
 */
function addTranscriptSubtitleTrack(params: {
  output: InstanceType<MediabunnyModule['Output']>
  TextSubtitleSource: MediabunnyModule['TextSubtitleSource']
  container: ClientExportSettings['container']
}): InstanceType<MediabunnyModule['TextSubtitleSource']> {
  const { output, TextSubtitleSource, container } = params

  const transcriptSubtitleSource = new TextSubtitleSource('webvtt')
  output.addSubtitleTrack(transcriptSubtitleSource, {
    languageCode: 'eng',
    name: 'Transcript',
    disposition: {
      default: true,
    },
  })
  getLog().info('Transcript subtitles will be embedded as WebVTT track', {
    container,
  })

  return transcriptSubtitleSource
}

export interface RenderEngineOptions {
  settings: ClientExportSettings
  composition: CompositionInputProps
  onProgress: (progress: RenderProgress) => void
  signal?: AbortSignal
}

interface AudioRenderOptions {
  settings: ClientExportSettings
  composition: CompositionInputProps
  onProgress: (progress: RenderProgress) => void
  signal?: AbortSignal
}

interface SingleFrameOptions {
  composition: CompositionInputProps
  frame: number
  width?: number
  height?: number
  quality?: number
  format?: 'image/jpeg' | 'image/png' | 'image/webp'
}

async function tryPacketRemuxComposition(
  options: RenderEngineOptions,
): Promise<ClientRenderResult | null> {
  const { settings, composition, onProgress, signal } = options
  const durationInFrames = composition.durationInFrames ?? 0
  const fps = composition.fps
  const durationSeconds = durationInFrames / Math.max(fps, 1)

  const plan = getPacketRemuxPlan(settings, composition)
  if (!plan) return null
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError')
  }

  const mediabunny: MediabunnyModule = await import('mediabunny')
  const { Input, Output, Conversion, ALL_FORMATS } = mediabunny

  const validationFormat = (await createOutputFormat(settings.container, { fastStart: false })) as {
    getSupportedVideoCodecs?: () => string[]
    getSupportedAudioCodecs?: () => string[]
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: createMediabunnyInputSource(mediabunny, plan.src),
  })

  let conversion: {
    cancel: () => Promise<void>
    isValid: boolean
    onProgress?: (progress: number, processedTime: number) => unknown
    execute: () => Promise<void>
  } | null = null
  const cancelConversion = () => {
    if (!conversion) return
    void conversion.cancel().catch(() => undefined)
  }

  signal?.addEventListener('abort', cancelConversion, { once: true })

  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (
      !isRemuxEligibleSourceVideo(
        {
          codec: videoTrack?.codec ?? null,
          displayWidth: videoTrack?.displayWidth ?? 0,
          displayHeight: videoTrack?.displayHeight ?? 0,
          getSupportedCodecs: () => validationFormat.getSupportedVideoCodecs?.() ?? [],
        },
        settings,
      )
    ) {
      return null
    }

    if (plan.includeAudio) {
      const audioTrack = await input.getPrimaryAudioTrack()
      if (
        !isRemuxEligibleSourceAudio({
          codec: audioTrack?.codec ?? null,
          getSupportedCodecs: () => validationFormat.getSupportedAudioCodecs?.() ?? [],
        })
      ) {
        return null
      }
    }

    onProgress({
      phase: 'preparing',
      progress: 5,
      totalFrames: durationInFrames,
      message: 'Preparing packet remux...',
    })

    // Create output resources only after all validation checks pass. File-backed
    // output keeps long remuxes out of the renderer process heap.
    const mimeType = getMimeType(settings.container, settings.codec)
    const outputTarget = await createExportOutputTarget(mediabunny, settings.container, mimeType)
    const format = await createOutputFormat(settings.container, {
      fastStart: outputTarget.kind === 'buffer',
    })
    const output = new Output({
      format: format as unknown as ConstructorParameters<typeof Output>[0]['format'],
      target: outputTarget.target,
    })
    let outputCompleted = false

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
        audio: plan.includeAudio ? { forceTranscode: false } : { discard: true },
        showWarnings: false,
      })

      if (!conversion.isValid) {
        return null
      }

      conversion.onProgress = (progress: number) => {
        const clamped = Math.max(0, Math.min(1, progress))
        onProgress({
          phase: 'encoding',
          progress: Math.round(clamped * 90),
          currentFrame: Math.round(clamped * durationInFrames),
          totalFrames: durationInFrames,
          message: 'Remuxing packets...',
        })
      }

      await conversion.execute()

      const completed = await outputTarget.complete()
      outputCompleted = true
      const { blob } = completed

      onProgress({
        phase: 'finalizing',
        progress: 100,
        currentFrame: durationInFrames,
        totalFrames: durationInFrames,
        message: 'Complete!',
      })

      getLog().info('Packet remux export completed', {
        durationSeconds,
        fileSize: blob.size,
        container: settings.container,
        codec: settings.codec,
        includeAudio: plan.includeAudio,
      })

      return {
        blob,
        mimeType,
        duration: durationSeconds,
        fileSize: blob.size,
        temporaryOutput: completed.temporaryOutput,
      }
    } finally {
      ;(output as unknown as { dispose?: () => void }).dispose?.()
      if (!outputCompleted) await outputTarget.discard()
    }
  } catch (error) {
    const isCanceled =
      signal?.aborted || (error instanceof Error && error.name === 'ConversionCanceledError')
    if (isCanceled) {
      throw new DOMException('Render cancelled', 'AbortError')
    }

    getLog().warn('Packet remux path failed; falling back to frame render', { error })
    return null
  } finally {
    signal?.removeEventListener('abort', cancelConversion)
    input.dispose()
  }
}

// ---------------------------------------------------------------------------
// renderComposition
// ---------------------------------------------------------------------------

/**
 * Main render function – orchestrates the entire client-side render.
 */
export async function renderComposition(options: RenderEngineOptions): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal } = options
  const { fps, durationInFrames = 0 } = composition
  const canvasAudio = await loadCanvasAudio()

  getLog().info('Starting enhanced client render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    width: settings.resolution.width,
    height: settings.resolution.height,
    codec: settings.codec,
    ...summarizeCompositionForRender(composition),
  })

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration')
  }

  const totalFrames = durationInFrames
  const durationSeconds = totalFrames / fps

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames,
    message: 'Loading encoder...',
  })

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError')
  }

  // Fast path: when the timeline is a single unmodified clip, remux packets directly.
  const remuxResult = await tryPacketRemuxComposition(options)
  if (remuxResult) {
    return remuxResult
  }

  // Dynamically import mediabunny (AC-3 decoder is loaded lazily by canvas-audio when needed)
  const mediabunny: MediabunnyModule = await import('mediabunny')
  const {
    Output,
    VideoSampleSource,
    VideoSample,
    AudioSampleSource,
    AudioSample,
    TextSubtitleSource,
  } = mediabunny

  onProgress({
    phase: 'preparing',
    progress: 5,
    totalFrames,
    message: 'Processing audio...',
  })

  const compositionHasAudio = await canvasAudio.hasAudioContent(composition)
  const useWindowedAudio = shouldUseWindowedAudioProcessing({
    hasAudioContent: compositionHasAudio,
    durationSeconds,
    supportsWindowedProcessing: () => canvasAudio.supportsWindowedAudioProcessing(composition),
  })

  onProgress({
    phase: 'preparing',
    progress: 15,
    totalFrames,
    message: 'Creating encoder...',
  })

  const mimeType = getMimeType(settings.container, settings.codec)
  const outputTarget = await createExportOutputTarget(mediabunny, settings.container, mimeType)
  const format = await createOutputFormat(settings.container, {
    fastStart: outputTarget.kind === 'buffer',
  })
  const packetAudio = compositionHasAudio
    ? await prepareAudioPacketCopy({
        mediabunny,
        canvasAudio,
        composition,
        supportedCodecs: format.getSupportedAudioCodecs(),
      })
    : null

  // Create output
  const output = new Output({
    format,
    target: outputTarget.target,
  })

  // Subtitle handling per mode — see resolveSubtitleExportPlan for the matrix.
  const {
    embedTranscriptSubtitles,
    fallbackToBurnIn,
    transcriptSubtitleVtt,
    renderCompositionInput,
  } = resolveTranscriptSubtitleExport({
    composition,
    subtitleMode: settings.subtitleMode,
    container: settings.container,
    supportsWebVttSubtitles: format.getSupportedSubtitleCodecs().includes('webvtt'),
  })

  if (fallbackToBurnIn) {
    getLog().warn(
      `${settings.container.toUpperCase()} can't embed a soft subtitle track; ` +
        'burning captions into the video instead.',
    )
  }

  const transcriptSubtitleSource = embedTranscriptSubtitles
    ? addTranscriptSubtitleTrack({ output, TextSubtitleSource, container: settings.container })
    : null

  // Get composition (project) resolution – this is what we render at, and the
  // export resolution we output, plus whether the two differ.
  const { compositionWidth, compositionHeight, exportWidth, exportHeight, needsScaling } =
    resolveRenderScalePlan(renderCompositionInput, settings.resolution)

  getLog().info('Resolution settings', {
    composition: { width: compositionWidth, height: compositionHeight },
    export: { width: exportWidth, height: exportHeight },
    needsScaling,
  })

  // Create canvas for rendering frames at COMPOSITION resolution
  // This ensures all positioning/transforms are calculated correctly
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight)
  // Keep default context settings to preserve hardware acceleration.
  // `willReadFrequently` can force software rendering and slow draw-heavy workloads.
  const ctx = renderCanvas.getContext('2d')

  if (!ctx) {
    if (packetAudio) {
      packetAudio.source.close()
      packetAudio.input.dispose()
    }
    throw new Error('Failed to create OffscreenCanvas 2D context')
  }

  // High-quality smoothing: media is often drawn scaled (e.g. cover-fill upscale),
  // and the default ('low') visibly softens fine detail like small slide text.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Create output canvas at EXPORT resolution (for encoding)
  // If no scaling needed, we'll use renderCanvas directly
  const outputCanvas = needsScaling ? new OffscreenCanvas(exportWidth, exportHeight) : renderCanvas
  const outputCtx = needsScaling ? outputCanvas.getContext('2d')! : ctx
  if (needsScaling) {
    outputCtx.imageSmoothingEnabled = true
    outputCtx.imageSmoothingQuality = 'high'
  }

  onProgress({
    phase: 'preparing',
    progress: 20,
    totalFrames,
    message: 'Setting up video encoder...',
  })

  // Create video source for explicit frame capture (at export resolution)
  // VideoSampleSource lets us control frame capture timing precisely with VideoSample
  // Use 'quality' latencyMode to enable B-frames and better rate control for offline encoding
  const videoSource = new VideoSampleSource({
    codec: settings.codec,
    bitrate: settings.videoBitrate ?? 10_000_000,
    bitrateMode: settings.bitrateMode ?? 'variable',
    keyFrameInterval: 2, // Keyframe every 2 seconds for better seeking
    latencyMode: 'quality', // Enables B-frames and consistent frame quality for offline encoding
  })

  // Add video track
  output.addVideoTrack(videoSource, {
    frameRate: fps,
  })

  let audioSource: InstanceType<typeof AudioSampleSource> | null = null

  if (packetAudio) {
    output.addAudioTrack(packetAudio.source)
    getLog().info('Audio will be copied without decoding or re-encoding')
  } else if (compositionHasAudio) {
    try {
      audioSource = await addEncodedAudioTrack({
        output,
        AudioSampleSource,
        settings,
        durationSeconds,
        useWindowedAudio,
      })
    } catch (error) {
      getLog().error('Failed to setup audio track', { error })
      await outputTarget.discard()
      throw error
    }
  }

  try {
    await output.start()

    if (transcriptSubtitleSource && transcriptSubtitleVtt) {
      await transcriptSubtitleSource.add(transcriptSubtitleVtt)
      transcriptSubtitleSource.close()
    }
  } catch (error) {
    if (packetAudio) {
      try {
        packetAudio.source.close()
      } finally {
        packetAudio.input.dispose()
      }
    }
    await outputTarget.discard()
    throw error
  }

  let videoRenderingStarted = false
  let audioError: unknown
  const reportAudioProgress = createAudioProgressReporter({
    onProgress,
    totalFrames,
    durationSeconds,
    hasVideoRenderingStarted: () => videoRenderingStarted,
  })

  // Audio and video now advance together. Mediabunny's source backpressure
  // bounds encoded data while windowed processing bounds decoded PCM memory.
  const audioTask: Promise<void> | null = packetAudio
    ? feedAudioPacketCopy({
        mediabunny,
        prepared: packetAudio,
        signal,
        onProgress: (seconds) => reportAudioProgress(seconds, 'copying'),
      })
    : audioSource
      ? (async () => {
          try {
            const encodedFrames = await addCompositionAudio({
              audioSource,
              AudioSample,
              canvasAudio,
              composition,
              useWindowedAudio,
              signal,
              onProgress: (frames) => reportAudioProgress(frames / 48_000, 'processing'),
            })
            getLog().info('Audio chunks fed to encoder', {
              duration: encodedFrames / 48_000,
              samples: encodedFrames,
              windowed: useWindowedAudio,
            })
          } finally {
            audioSource.close()
            audioSource = null
          }
        })()
      : null
  void audioTask?.catch((error: unknown) => {
    audioError = error
  })

  onProgress({
    phase: 'rendering',
    progress: 0,
    currentFrame: 0,
    totalFrames,
    message: 'Rendering frames...',
  })

  let frameRenderer: Awaited<ReturnType<typeof createCompositionRenderer>> | null = null

  try {
    frameRenderer = await createCompositionRenderer(renderCompositionInput, renderCanvas, ctx)
    // Preload media
    await frameRenderer.preload()
    videoRenderingStarted = true
    if (audioError) throw audioError

    // Render each frame using a pipelined double-buffer approach.
    // VideoSample copies pixel data on construction, so the canvas is free
    // immediately after. We overlap the previous frame's encode with the
    // next frame's render for ~25-40% throughput improvement.
    const renderer = frameRenderer
    await runPipelinedFrameLoop({
      totalFrames,
      signal,
      getPendingError: () => audioError,
      renderFrame: async (frame) => {
        await renderer.renderFrame(frame)
        // Scale to output resolution if needed
        if (needsScaling) {
          outputCtx.clearRect(0, 0, exportWidth, exportHeight)
          outputCtx.drawImage(renderCanvas, 0, 0, exportWidth, exportHeight)
        }
      },
      // VideoSampleSource does NOT close samples (unlike CanvasSource) — the
      // loop closes each sample to release the VideoFrame's GPU memory.
      captureSample: (frame) =>
        new VideoSample(outputCanvas, { timestamp: frame / fps, duration: 1 / fps }),
      encodeSample: (sample, keyFrame) =>
        keyFrame ? videoSource.add(sample, { keyFrame: true }) : videoSource.add(sample),
      onAbort: () => output.cancel(),
      onFrameProgress: (frame) => {
        onProgress({
          phase: 'rendering',
          progress: Math.round((frame / totalFrames) * 100),
          currentFrame: frame,
          totalFrames,
          message: `Rendering frame ${frame + 1}/${totalFrames}`,
        })
      },
    })

    if (audioTask) {
      onProgress({
        phase: 'encoding',
        progress: 94,
        currentFrame: totalFrames,
        totalFrames,
        message: 'Finishing audio...',
      })
      await audioTask
    }

    onProgress({
      phase: 'finalizing',
      progress: 95,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Finalizing video...',
    })

    // Finalize output
    await output.finalize()

    const completed = await outputTarget.complete()
    const { blob } = completed

    onProgress({
      phase: 'finalizing',
      progress: 100,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Complete!',
    })

    // Cleanup
    frameRenderer.dispose()
    canvasAudio.clearAudioDecodeCache()

    return {
      blob,
      mimeType,
      duration: durationSeconds,
      fileSize: blob.size,
      temporaryOutput: completed.temporaryOutput,
    }
  } catch (error) {
    // Cleanup on error
    frameRenderer?.dispose()
    canvasAudio.clearAudioDecodeCache()

    // Attempt to cancel the output on error
    try {
      if (output.state === 'started') {
        await output.cancel()
      }
    } catch {
      // Ignore cancel errors
    }
    if (audioTask) await Promise.allSettled([audioTask])
    await outputTarget.discard()
    throw error
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
  } = options

  const compositionWidth = composition.width || DEFAULT_PROJECT_WIDTH
  const compositionHeight = composition.height || DEFAULT_PROJECT_HEIGHT

  getLog().debug('Rendering single frame', {
    frame,
    width,
    height,
    compositionWidth,
    compositionHeight,
  })

  // Create canvas at full composition size
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight)
  const renderCtx = renderCanvas.getContext('2d')
  if (!renderCtx) {
    throw new Error('Failed to get 2d context')
  }

  // Match the export composition context so single-frame output is
  // pixel-consistent with the final render (scaled media draws stay sharp).
  renderCtx.imageSmoothingEnabled = true
  renderCtx.imageSmoothingQuality = 'high'

  // Use the SAME renderer as export – single source of truth
  const renderer = await createCompositionRenderer(composition, renderCanvas, renderCtx)
  try {
    await renderer.preload()
    await renderer.renderFrame(frame)

    // Progressive downscale to thumbnail size to avoid aliasing/moire
    // with high-frequency effects (e.g. halftone fine lines).
    // Halve dimensions repeatedly until within 2x of target, then final scale.
    let srcCanvas: OffscreenCanvas = renderCanvas
    let srcW = compositionWidth
    let srcH = compositionHeight

    while (srcW > width * 2 || srcH > height * 2) {
      const nextW = Math.max(Math.ceil(srcW / 2), width)
      const nextH = Math.max(Math.ceil(srcH / 2), height)
      const step = new OffscreenCanvas(nextW, nextH)
      const stepCtx = step.getContext('2d')!
      stepCtx.imageSmoothingQuality = 'high'
      stepCtx.drawImage(srcCanvas, 0, 0, nextW, nextH)
      srcCanvas = step
      srcW = nextW
      srcH = nextH
    }

    const thumbnailCanvas = new OffscreenCanvas(width, height)
    const thumbnailCtx = thumbnailCanvas.getContext('2d')
    if (!thumbnailCtx) {
      throw new Error('Failed to get thumbnail 2d context')
    }

    thumbnailCtx.imageSmoothingQuality = 'high'
    thumbnailCtx.drawImage(srcCanvas, 0, 0, width, height)

    const blob = await thumbnailCanvas.convertToBlob({ type: format, quality })
    return blob
  } finally {
    try {
      renderer.dispose()
    } catch (error) {
      getLog().warn('Failed to dispose single-frame renderer', { error })
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
  const { settings, composition, onProgress, signal } = options
  const { fps, durationInFrames = 0 } = composition
  const canvasAudio = await loadCanvasAudio()

  getLog().info('Starting audio-only render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    container: settings.container,
    audioCodec: settings.audioCodec,
    audioBitrate: settings.audioBitrate,
  })

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration')
  }

  const durationSeconds = durationInFrames / fps

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames: durationInFrames,
    message: 'Loading encoder...',
  })

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError')
  }

  // Dynamically import mediabunny (AC-3 decoder is loaded lazily by canvas-audio when needed)
  const mediabunny = await import('mediabunny')
  const { Output, AudioSampleSource, AudioSample } = mediabunny

  await registerMp3EncoderIfNeeded(settings.container)

  onProgress({
    phase: 'preparing',
    progress: 10,
    totalFrames: durationInFrames,
    message: 'Processing audio...',
  })

  // Process audio
  if (!(await canvasAudio.hasAudioContent(composition))) {
    throw new Error('No audio content found in composition')
  }

  // Audio content was validated above, so only the duration/windowing gates remain.
  const useWindowedAudio = shouldUseWindowedAudioProcessing({
    hasAudioContent: true,
    durationSeconds,
    supportsWindowedProcessing: () => canvasAudio.supportsWindowedAudioProcessing(composition),
  })

  onProgress({
    phase: 'preparing',
    progress: 50,
    totalFrames: durationInFrames,
    message: 'Creating encoder...',
  })

  const audioCodec = resolveAudioOnlyCodec(settings.container)
  const audioBitrate = settings.audioBitrate ?? 192_000
  await assertAudioOnlyEncoderSupported(audioCodec, audioBitrate)

  const mimeType = getMimeType(settings.container)
  const outputTarget = await createExportOutputTarget(mediabunny, settings.container, mimeType)
  const format = await createOutputFormat(settings.container, {
    fastStart: outputTarget.kind === 'buffer',
  })
  const output = new Output({ format, target: outputTarget.target })

  // Create audio source for encoding
  const audioSource = new AudioSampleSource({
    codec: audioCodec,
    bitrate: audioBitrate,
  })

  // Add audio track to output
  output.addAudioTrack(audioSource)

  getLog().info('Audio track configured', {
    duration: durationSeconds,
    channels: 2,
    sampleRate: 48_000,
    codec: audioCodec,
    windowed: useWindowedAudio,
  })

  onProgress({
    phase: 'encoding',
    progress: 60,
    totalFrames: durationInFrames,
    message: 'Encoding audio...',
  })

  let completed: Awaited<ReturnType<typeof outputTarget.complete>>
  try {
    await output.start()
    await addCompositionAudio({
      audioSource,
      AudioSample,
      canvasAudio,
      composition,
      useWindowedAudio,
      signal,
      onProgress: (frames) => {
        onProgress({
          phase: 'encoding',
          progress: 60 + Math.round((frames / 48_000 / durationSeconds) * 30),
          totalFrames: durationInFrames,
          message: `Encoding audio ${formatClock(frames / 48_000)} / ${formatClock(durationSeconds)}`,
        })
      },
    })

    onProgress({
      phase: 'finalizing',
      progress: 90,
      totalFrames: durationInFrames,
      message: 'Finalizing audio...',
    })

    audioSource.close()
    await output.finalize()
    completed = await outputTarget.complete()
  } catch (error) {
    try {
      if (output.state === 'started') await output.cancel()
    } catch {
      // Ignore cancellation errors; preserve the original failure.
    }
    await outputTarget.discard()
    throw error
  }

  const { blob } = completed

  onProgress({
    phase: 'finalizing',
    progress: 100,
    totalFrames: durationInFrames,
    message: 'Complete!',
  })

  return {
    blob,
    mimeType,
    duration: durationSeconds,
    fileSize: blob.size,
    temporaryOutput: completed.temporaryOutput,
  }
}
