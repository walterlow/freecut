export interface CaptureOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** If true, capture at container size without scaling */
  fullResolution?: boolean;
}

export type PreviewQuality = 1 | 0.5 | 0.25;

export interface PlaybackState {
  currentFrame: number;
  /** Internal epoch for last currentFrame mutation (monotonic per store session) */
  currentFrameEpoch: number;
  isPlaying: boolean;
  playbackRate: number;
  loop: boolean;
  volume: number;
  muted: boolean;
  zoom: number;
  /** Frame to preview on hover (null when not hovering) */
  previewFrame: number | null;
  /** Internal epoch for last previewFrame mutation (monotonic per store session) */
  previewFrameEpoch: number;
  /** Internal shared mutation counter used to order frame updates */
  frameUpdateEpoch: number;
  /** Item ID under the cursor when previewing (null when not over an item) */
  previewItemId: string | null;
  /** Function to capture the current Player frame as a data URL (set by VideoPreview) */
  captureFrame: ((options?: CaptureOptions) => Promise<string | null>) | null;
  /** Whether to use proxy videos for preview playback (true = use 720p proxies when available) */
  useProxy: boolean;
  /** Preview render resolution multiplier (1 = full, 0.5 = half, 0.25 = quarter) */
  previewQuality: PreviewQuality;
}

export interface PlaybackActions {
  setCurrentFrame: (frame: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setZoom: (zoom: number) => void;
  setPreviewFrame: (frame: number | null, itemId?: string | null) => void;
  /** Register a frame capture function (called by VideoPreview on mount) */
  setCaptureFrame: (fn: ((options?: CaptureOptions) => Promise<string | null>) | null) => void;
  /** Toggle proxy playback mode */
  toggleUseProxy: () => void;
  /** Set preview render quality */
  setPreviewQuality: (quality: PreviewQuality) => void;
}
