import type { AudioEqSettings } from '@/types/audio';

export interface CaptureOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** If true, capture at container size without scaling */
  fullResolution?: boolean;
}

export type PreviewQuality = 1 | 0.5 | 0.33 | 0.25;

export interface PlaybackState {
  currentFrame: number;
  /** Internal epoch for last currentFrame mutation (monotonic per store session) */
  currentFrameEpoch: number;
  isPlaying: boolean;
  playbackRate: number;
  loop: boolean;
  /**
   * Per-device monitor gain (linear, 1 = unity). Persisted to localStorage,
   * affects only the preview player — not exports. Separate from the
   * project-scoped master bus gain below.
   */
  volume: number;
  muted: boolean;
  /**
   * Project-scoped master bus gain in dB, applied to the final mix in both
   * preview and export. Loaded from / saved to the active project's timeline.
   * Defaults to 0 (unity) for new/loaded projects.
   */
  masterBusDb: number;
  busAudioEq?: AudioEqSettings;
  zoom: number;
  /** Frame to preview on hover (null when not hovering) */
  previewFrame: number | null;
  /** Internal epoch for last previewFrame mutation (monotonic per store session) */
  previewFrameEpoch: number;
  /** Internal shared mutation counter used to order frame updates */
  frameUpdateEpoch: number;
  /** Item ID under the cursor when previewing (null when not over an item) */
  previewItemId: string | null;
  /** Whether to use proxy videos for preview playback (true = use 720p proxies when available) */
  useProxy: boolean;
  /** Fast-scrub render resolution multiplier (1 = full, 0.5 = half, 0.33 = third, 0.25 = quarter) */
  previewQuality: PreviewQuality;
}

export interface PlaybackActions {
  setCurrentFrame: (frame: number) => void;
  /** Update the authoritative playhead and transient scrub preview atomically. */
  setScrubFrame: (frame: number, itemId?: string | null) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setMasterBusDb: (db: number) => void;
  setBusAudioEq: (eq: AudioEqSettings | undefined) => void;
  setZoom: (zoom: number) => void;
  setPreviewFrame: (frame: number | null, itemId?: string | null) => void;
  /** Toggle proxy playback mode */
  toggleUseProxy: () => void;
  /** Set fast-scrub render quality */
  setPreviewQuality: (quality: PreviewQuality) => void;
}
