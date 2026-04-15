import type { CaptureOptions } from '@/shared/state/playback';

export type PreviewVisualPlaybackMode = 'player' | 'streaming';

export interface PreviewBridgeState {
  /** Frame currently presented to the user in preview output (null when Player path is active) */
  displayedFrame: number | null;
  /** Which visual path currently owns preview playback. */
  visualPlaybackMode: PreviewVisualPlaybackMode;
  /** Function to capture the current Player frame as a data URL (set by VideoPreview) */
  captureFrame: ((options?: CaptureOptions) => Promise<string | null>) | null;
  /** Optional raw capture path that returns ImageData directly (avoids encode/decode overhead) */
  captureFrameImageData: ((options?: CaptureOptions) => Promise<ImageData | null>) | null;
  /** Returns the rendered canvas directly for GPU-accelerated scope analysis (near-zero-copy) */
  captureCanvasSource: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null;
}

export interface PreviewBridgeActions {
  setDisplayedFrame: (frame: number | null) => void;
  setVisualPlaybackMode: (mode: PreviewVisualPlaybackMode) => void;
  /** Register a frame capture function (called by VideoPreview on mount) */
  setCaptureFrame: (fn: ((options?: CaptureOptions) => Promise<string | null>) | null) => void;
  /** Register raw frame capture function for scopes (optional) */
  setCaptureFrameImageData: (fn: ((options?: CaptureOptions) => Promise<ImageData | null>) | null) => void;
  /** Register canvas source capture for GPU scopes (optional) */
  setCaptureCanvasSource: (fn: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null) => void;
}
