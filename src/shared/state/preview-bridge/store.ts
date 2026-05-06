import { create } from 'zustand'
import type { PreviewBridgeActions, PreviewBridgeState } from './types'

function normalizeFrame(frame: number | null): number | null {
  if (frame == null) return null
  if (!Number.isFinite(frame)) {
    if (import.meta.env.DEV) {
      console.warn('[PreviewBridge] normalizeFrame received non-finite value:', frame)
    }
    return 0
  }
  return Math.max(0, Math.round(frame))
}

function normalizeFrames(frames: number[]): number[] {
  const normalized: number[] = []
  const seen = new Set<number>()

  for (const frame of frames) {
    const nextFrame = normalizeFrame(frame)
    if (nextFrame == null || seen.has(nextFrame)) continue
    seen.add(nextFrame)
    normalized.push(nextFrame)
  }

  return normalized
}

export const usePreviewBridgeStore = create<PreviewBridgeState & PreviewBridgeActions>()((set) => ({
  displayedFrame: null,
  captureFrame: null,
  captureFrameImageData: null,
  captureCanvasSource: null,
  postEditWarmRequest: null,

  setDisplayedFrame: (frame) =>
    set((state) => {
      const nextFrame = normalizeFrame(frame)
      if (state.displayedFrame === nextFrame) return state
      return { displayedFrame: nextFrame }
    }),
  setCaptureFrame: (fn) => set({ captureFrame: fn }),
  setCaptureFrameImageData: (fn) => set({ captureFrameImageData: fn }),
  setCaptureCanvasSource: (fn) => set({ captureCanvasSource: fn }),
  requestPostEditWarm: (frame, itemIds, frames = []) =>
    set((state) => {
      const normalizedFrame = normalizeFrame(frame) ?? 0
      const normalizedFrames = normalizeFrames(frames.length > 0 ? frames : [normalizedFrame])

      return {
        postEditWarmRequest: {
          frame: normalizedFrame,
          frames: normalizedFrames,
          itemIds: [...itemIds],
          token: (state.postEditWarmRequest?.token ?? 0) + 1,
        },
      }
    }),
}))
