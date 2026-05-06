import type { VideoItem } from '@/types/timeline'
import { getVideoTargetTimeSeconds } from '@/features/export/deps/composition-runtime'
import type { RenderTimelineSpan } from './render-span'
import { getRenderTimelineSourceStart } from './render-span'
import type { VideoFrameSource } from './shared-video-extractor'

const DEFAULT_MAX_BYTES = 96 * 1024 * 1024
const DEFAULT_MAX_WINDOW_FRAMES = 4
const MIN_WINDOW_FRAMES = 2

interface CachedFrame {
  frame: VideoFrame
}

interface ItemWindow {
  startFrame: number
  endFrame: number
  frames: Map<number, CachedFrame>
}

export interface ReverseVideoFrameRequest {
  item: VideoItem
  extractor: VideoFrameSource
  frame: number
  renderSpan: RenderTimelineSpan
  fps: number
  sourceFps: number
  speed: number
}

/**
 * Export-only cache for reversed clips.
 *
 * Rendering a reversed clip naively asks the decoder for source timestamps in
 * descending order, which forces stream restarts around keyframes. This cache
 * looks ahead over a bounded output-frame window, decodes those source times in
 * ascending source order, then serves them back to the renderer in timeline
 * order.
 */
export class ReverseVideoFrameCache {
  private readonly itemWindows = new Map<string, ItemWindow>()

  constructor(private readonly maxBytes = DEFAULT_MAX_BYTES) {}

  async getFrame(request: ReverseVideoFrameRequest): Promise<VideoFrame | null> {
    const existing = this.itemWindows.get(request.item.id)
    const key = this.getSourceFrameKey(request)
    if (
      existing &&
      request.frame >= existing.startFrame &&
      request.frame < existing.endFrame &&
      existing.frames.has(key)
    ) {
      return existing.frames.get(key)?.frame ?? null
    }

    const window = await this.buildWindow(request)
    this.replaceWindow(request.item.id, window)
    return window.frames.get(key)?.frame ?? null
  }

  dispose(): void {
    for (const window of this.itemWindows.values()) {
      this.closeWindow(window)
    }
    this.itemWindows.clear()
  }

  private async buildWindow(request: ReverseVideoFrameRequest): Promise<ItemWindow> {
    const dims = request.extractor.getDimensions()
    const frameBytes = Math.max(1, dims.width * dims.height * 4)
    const memoryBoundFrames = Math.floor(this.maxBytes / frameBytes)
    const windowFrames = Math.max(
      MIN_WINDOW_FRAMES,
      Math.min(DEFAULT_MAX_WINDOW_FRAMES, memoryBoundFrames || MIN_WINDOW_FRAMES),
    )
    const startFrame = request.frame
    const endFrame = Math.min(
      request.renderSpan.from + request.renderSpan.durationInFrames,
      startFrame + windowFrames,
    )

    const targets = new Map<number, number>()
    for (let outputFrame = startFrame; outputFrame < endFrame; outputFrame += 1) {
      const sourceTime = this.getSourceTime(request, outputFrame)
      targets.set(this.sourceFrameKey(sourceTime, request.sourceFps), sourceTime)
    }

    const sortedTargets = [...targets.entries()].sort((a, b) => a[1] - b[1])
    const frames = new Map<number, CachedFrame>()
    for (const [key, sourceTime] of sortedTargets) {
      const result = await request.extractor.captureFrame(sourceTime)
      if (!result.success || !result.frame) {
        continue
      }
      frames.set(key, { frame: result.frame })
    }

    return { startFrame, endFrame, frames }
  }

  private replaceWindow(itemId: string, next: ItemWindow): void {
    const previous = this.itemWindows.get(itemId)
    if (previous) {
      this.closeWindow(previous)
    }
    this.itemWindows.set(itemId, next)
  }

  private closeWindow(window: ItemWindow): void {
    for (const cached of window.frames.values()) {
      try {
        cached.frame.close()
      } catch {
        // Ignore close errors from already-detached frames.
      }
    }
    window.frames.clear()
  }

  private getSourceFrameKey(request: ReverseVideoFrameRequest): number {
    return this.sourceFrameKey(this.getSourceTime(request, request.frame), request.sourceFps)
  }

  private getSourceTime(request: ReverseVideoFrameRequest, outputFrame: number): number {
    const localFrame = outputFrame - request.renderSpan.from
    const sourceStart = getRenderTimelineSourceStart(request.item, request.renderSpan)
    const sourceFramesNeeded =
      (request.item.durationInFrames * request.speed * request.sourceFps) / request.fps
    const reverseSourceEnd = request.item.sourceEnd ?? sourceStart + sourceFramesNeeded
    const unclampedSourceTime = getVideoTargetTimeSeconds(
      sourceStart,
      request.sourceFps,
      localFrame,
      request.speed,
      request.fps,
      0,
      true,
      reverseSourceEnd,
    )
    const duration = request.extractor.getDuration()
    return duration > 0
      ? Math.max(0, Math.min(unclampedSourceTime, duration - 1e-4))
      : Math.max(0, unclampedSourceTime)
  }

  private sourceFrameKey(sourceTime: number, sourceFps: number): number {
    return Math.round(sourceTime * sourceFps)
  }
}
