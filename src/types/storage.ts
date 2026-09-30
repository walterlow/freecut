/**
 * Storage type for media files
 * - 'handle':    Uses FileSystemFileHandle — references the user's original
 *                file on disk (instant import, no copy). Origin-scoped.
 * - 'workspace': Source bytes copied into the user-picked workspace folder
 *                (`media/{id}/{filename}`). Durable and shared across every
 *                origin that picks the same folder — the source of truth for
 *                media with no user file handle (remote/generated/copied).
 * - 'opfs':      Legacy: source copied into the Origin Private File System.
 *                Origin-scoped, so NOT visible cross-origin. No longer written
 *                for source media (use 'workspace'); still read for records
 *                imported by older builds, and the repair sweep mirrors them
 *                into the workspace folder. OPFS remains the store for
 *                regenerable caches (proxies, waveforms, decoded audio).
 */
export type MediaStorageType = 'handle' | 'workspace' | 'opfs'

/**
 * Provenance + usage terms for media imported from a third-party provider.
 * All fields optional except `provider` so callers can record whatever the
 * source exposes. Currently populated by the LottieFiles browser.
 */
export interface MediaAttribution {
  /** Human-readable source, e.g. "LottieFiles". */
  provider: string
  /** Original creator's display name. */
  author?: string
  /** Link to the creator's profile or the source page. */
  authorUrl?: string
  /** Direct link back to the asset on the provider. */
  sourceUrl?: string
  /** Provider-native asset id, for dedupe/lookup. */
  sourceId?: string
  /** License the asset is distributed under, e.g. "Lottie Simple License". */
  license?: string
}

export interface MediaMetadata {
  id: string
  /**
   * How the media file is stored (see {@link MediaStorageType}).
   * - 'handle':    references the user's original file on disk
   * - 'workspace': source bytes copied into the workspace folder (durable, cross-origin)
   * - 'opfs':      legacy Origin Private File System copy (origin-scoped)
   */
  storageType: MediaStorageType
  /**
   * FileSystemFileHandle for direct disk access (when storageType === 'handle')
   * Stored in IndexedDB - requires permission re-request on new sessions
   */
  fileHandle?: FileSystemFileHandle
  /**
   * OPFS path (when storageType === 'opfs')
   * Format: content/{shard1}/{shard2}/{uuid}/data
   */
  opfsPath?: string
  /**
   * Content identifier for deduplication (hash or UUID)
   * Only computed when needed for dedup checks
   */
  contentHash?: string
  /**
   * Last modified timestamp from source file (File.lastModified).
   * Used as part of source identity for shared proxy reuse.
   */
  fileLastModified?: number
  fileName: string
  fileSize: number
  mimeType: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitrate: number
  /**
   * Audio codec identifier (e.g., 'aac', 'ec-3', 'ac-3')
   * Only present for video files with audio tracks
   */
  audioCodec?: string
  /**
   * Whether the audio codec is supported for waveform generation
   * false for codecs like EC-3 (Dolby Digital Plus), AC-3, DTS that can't be decoded in browser
   */
  audioCodecSupported?: boolean
  /**
   * Whether the browser can decode the video track via WebCodecs.
   * False for codecs like ProRes that require a transcoded proxy to be viewable.
   */
  videoCodecSupported?: boolean
  /**
   * Conformed preview-audio asset path for custom-decoded codecs.
   * Kept under the legacy name for compatibility, but now points to the
   * workspace-backed persisted WAV path.
   */
  previewAudioOpfsPath?: string
  previewAudioMimeType?: string
  previewAudioConformedAt?: number
  /**
   * Sorted keyframe (sync sample / IDR) timestamps in seconds.
   * Extracted at import time via mediabunny EncodedPacketSink.
   * Used for adaptive seek backtracking instead of fixed 1-second backtrack.
   * Undefined for images/audio, null-ish for all-intra video (no optimization needed).
   */
  keyframeTimestamps?: number[]
  /**
   * Average interval between keyframes in seconds (GOP length).
   * Derived from keyframeTimestamps at import time.
   * Useful for diagnostics, UI display, and fallback seek heuristics.
   */
  gopInterval?: number
  thumbnailId?: string
  tags: string[]
  /** Whether this media is a 360° equirectangular video or photo */
  is360?: boolean
  /** Video/media projection format: 'spherical_360' (true 360), 'ultrawide' (flat wide/action cam), or 'standard' */
  projectionType?: 'spherical_360' | 'ultrawide' | 'standard'
  /**
   * Provenance for media pulled from a third-party provider (e.g. the
   * in-app LottieFiles browser). Persisted so the editor can surface the
   * required attribution/license for assets that carry usage terms.
   */
  attribution?: MediaAttribution
  /**
   * AI-generated timestamped captions from LFM vision-language model.
   * Mirrors the canonical `cache/ai/captions.json` payload for in-memory
   * consumers (search, Scene Browser). See `MediaCaption` in
   * `lib/analysis/captioning/types.ts` for the full shape including optional
   * thumbnail paths, semantic embeddings, and color palettes.
   */
  aiCaptions?: Array<{
    timeSec: number
    text: string
    sceneData?: {
      caption?: string
      shotType?: string
      subjects?: string[]
      action?: string
      setting?: string
      lighting?: string
      timeOfDay?: string
      weather?: string
    }
    thumbRelPath?: string
    embedding?: number[]
    palette?: Array<{ l: number; a: number; b: number; weight: number }>
  }>
  createdAt: number
  updatedAt: number
}

// Content record for reference counting in content-addressable storage
export interface ContentRecord {
  hash: string // SHA-256 hash (primary key)
  fileSize: number
  mimeType: string
  referenceCount: number // Number of media entries referencing this content
  createdAt: number
}

// Project-media association for per-project media isolation
export interface ProjectMediaAssociation {
  projectId: string
  mediaId: string
  addedAt: number
}

export interface ThumbnailData {
  id: string
  mediaId: string
  blob: Blob
  timestamp: number
  width: number
  height: number
}

export type MediaTranscriptModel =
  | 'parakeet-tdt-v3'
  | 'whisper-tiny'
  | 'whisper-base'
  | 'whisper-small'
  | 'whisper-large'
  | (string & {})

export type MediaTranscriptQuantization = 'hybrid' | 'fp32' | 'fp16' | 'q8' | 'q4'

export interface MediaTranscriptSegment {
  text: string
  start: number
  end: number
  words?: MediaTranscriptWord[]
}

export interface MediaTranscriptWord {
  text: string
  start: number
  end: number
  confidence?: number
}

export interface MediaTranscript {
  id: string // Same as mediaId
  mediaId: string
  model: MediaTranscriptModel
  language?: string
  quantization: MediaTranscriptQuantization
  text: string
  segments: MediaTranscriptSegment[]
  createdAt: number
  updatedAt: number
}

// Waveform data for timeline audio clip visualization
export interface WaveformData {
  id: string // Same as mediaId
  mediaId: string
  peaks: ArrayBuffer // Float32Array as ArrayBuffer (normalized 0-1)
  duration: number // Audio duration in seconds
  sampleRate: number // Samples per second in peaks data
  channels: number // Number of audio channels
  createdAt: number
}

// Streaming waveform cache records (meta + bins in persisted storage).
export interface WaveformMeta {
  id: string // Same as mediaId
  mediaId: string
  kind: 'meta'
  sampleRate: number // Samples/sec in stored bins
  totalSamples: number // Total peak sample count
  binCount: number // Number of bins
  binDurationSec: number // Seconds per bin (typically 30)
  duration: number // Audio duration in seconds
  channels: number // Channel count from source media
  stereo?: boolean // True when peaks are interleaved [L0,R0,L1,R1...]
  createdAt: number
}

export interface WaveformBin {
  id: string // `${mediaId}:bin:${binIndex}`
  mediaId: string
  kind: 'bin'
  binIndex: number
  peaks: ArrayBuffer // Float32 peaks for this bin
  samples: number // Actual peak count in this bin
  createdAt?: number
}

export type WaveformRecord = WaveformData | WaveformMeta | WaveformBin

// Decoded preview audio for custom-decoded codecs (persisted across refresh)
// Stored as 30-second bins (Int16 @ 22050 Hz stereo ≈ 2.5 MB/bin)

export interface DecodedPreviewAudioMeta {
  id: string // Same as mediaId
  mediaId: string
  kind: 'meta'
  sampleRate: number // Stored sample rate (22050 Hz)
  totalFrames: number // Total frames at stored sample rate
  binCount: number // Number of bins
  binDurationSec: number // Seconds per bin (30)
  createdAt: number
}

export interface DecodedPreviewAudioBin {
  id: string // `${mediaId}:bin:${binIndex}`
  mediaId: string
  kind: 'bin'
  binIndex: number
  left: ArrayBuffer // Int16 PCM
  right: ArrayBuffer // Int16 PCM
  frames: number // Actual frame count (last bin may be shorter)
  sampleRate?: number // Stored sample rate (may differ from STORAGE_SAMPLE_RATE for low-rate sources)
  createdAt?: number
}

export type DecodedPreviewAudio = DecodedPreviewAudioMeta | DecodedPreviewAudioBin

// GIF frame data for pre-extracted animation frames
export interface GifFrameData {
  id: string // Same as mediaId
  mediaId: string
  frames: Blob[] // PNG blobs for each frame (preserves transparency)
  durations: number[] // Per-frame delay in milliseconds
  totalDuration: number // Total animation duration in milliseconds
  width: number // Frame width in pixels
  height: number // Frame height in pixels
  frameCount: number // Total number of frames
  createdAt: number
}
