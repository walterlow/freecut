import type { CaptureOptions } from '@/shared/state/playback'

export interface PostEditWarmRequest {
  frame: number
  frames: number[]
  itemIds: string[]
  token: number
}

export interface PreviewBridgeState {
  /** Frame currently presented to the user in preview output (null when Player path is active) */
  displayedFrame: number | null
  /** Function to capture the current Player frame as a data URL (set by VideoPreview) */
  captureFrame: ((options?: CaptureOptions) => Promise<string | null>) | null
  /** Optional raw capture path that returns ImageData directly (avoids encode/decode overhead) */
  captureFrameImageData: ((options?: CaptureOptions) => Promise<ImageData | null>) | null
  /** Returns the rendered canvas directly for GPU-accelerated scope analysis (near-zero-copy) */
  captureCanvasSource: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null
  /** Latest request to prewarm the preview renderer after an edit commit. */
  postEditWarmRequest: PostEditWarmRequest | null
}

export interface PreviewBridgeActions {
  setDisplayedFrame: (frame: number | null) => void
  /** Register a frame capture function (called by VideoPreview on mount) */
  setCaptureFrame: (fn: ((options?: CaptureOptions) => Promise<string | null>) | null) => void
  /** Register raw frame capture function for scopes (optional) */
  setCaptureFrameImageData: (
    fn: ((options?: CaptureOptions) => Promise<ImageData | null>) | null,
  ) => void
  /** Register canvas source capture for GPU scopes (optional) */
  setCaptureCanvasSource: (
    fn: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null,
  ) => void
  requestPostEditWarm: (frame: number, itemIds: string[], frames?: number[]) => void
}
