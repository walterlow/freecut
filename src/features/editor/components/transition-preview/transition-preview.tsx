import { memo, useCallback, useEffect, useRef } from 'react'
import { transitionRegistry } from '@/shared/timeline/transitions'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import type { WipeDirection, SlideDirection, FlipDirection } from '@/types/transition'
import { getSampleFrames, PREVIEW_WIDTH, PREVIEW_HEIGHT, type SampleFrames } from './sample-frames'
import {
  ensureGpuTransitionPipeline,
  getReadyGpuTransitionPipeline,
} from './gpu-transition-preview'

const log = createLogger('TransitionPreview')

/** One full A→B sweep in ms; the loop ping-pongs so the dissolve never hard-cuts. */
const SWEEP_MS = 1100
/** Resting progress for most transitions — a clean mid-transition half state. */
const POSTER_PROGRESS = 0.5
/**
 * Transitions that dip through black at the midpoint (fade, dip-to-color, flip)
 * have no progress that is both mid-transition and bright, so a 0.5 poster reads
 * as a broken black tile. Park them near the start instead, at full brightness,
 * so the grid stays visually consistent — the dip is shown on hover.
 */
const BRIGHT_POSTER_PROGRESS = 0.1
const BRIGHT_POSTER_IDS = new Set(['fade', 'dipToColorDissolve', 'flip'])

interface TransitionPreviewProps {
  /** Presentation id registered in the transition registry (e.g. 'dissolve'). */
  presentationId: string
  /** Direction for directional transitions (wipe/slide/flip); omit otherwise. */
  direction?: WipeDirection | SlideDirection | FlipDirection
  /** True while the host card is hovered — drives the animation loop. */
  active: boolean
  className?: string
}

type PreviewDirection = WipeDirection | SlideDirection | FlipDirection | undefined

/**
 * Draw the transition through the real WebGPU shaders. Returns true on success,
 * false when no GPU shader exists, the pipeline isn't ready, or the render is
 * empty — in which case the caller should fall back to the Canvas 2D path.
 */
function tryDrawGpuTransitionPreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frames: SampleFrames,
  presentationId: string,
  direction: PreviewDirection,
  progress: number,
): boolean {
  const gpuId = transitionRegistry.getRenderer(presentationId)?.gpuTransitionId
  if (!gpuId) return false
  const pipeline = getReadyGpuTransitionPipeline()
  if (!pipeline?.has(gpuId)) return false
  const result = pipeline.render(
    gpuId,
    frames.a,
    frames.b,
    progress,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    direction,
  )
  if (!result) return false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(result, 0, 0, canvas.width, canvas.height)
  return true
}

/** Draw the transition through the renderer's Canvas 2D fallback path. */
function drawCanvasTransitionPreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frames: SampleFrames,
  presentationId: string,
  direction: PreviewDirection,
  outRef: { current: OffscreenCanvas | null },
  progress: number,
): void {
  const renderer = transitionRegistry.getRenderer(presentationId)
  if (!renderer?.renderCanvas) return
  const out = (outRef.current ??= new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT))
  const outCtx = out.getContext('2d')
  if (!outCtx) return
  try {
    outCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    renderer.renderCanvas(outCtx, frames.a, frames.b, progress, direction, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
    })
  } catch (error) {
    log.warn('renderCanvas failed for preview', { presentationId, error: String(error) })
    return
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(out, 0, 0, canvas.width, canvas.height)
}

/**
 * A small canvas that previews a transition over two contrasting sample stills.
 * Shader-driven transitions render through the real WebGPU `TransitionPipeline`
 * for true fidelity; everything else uses the renderer's Canvas 2D path. Idle at
 * rest on a mid-transition poster frame; animates only while `active` (hovered),
 * mirroring the on-hover motion-preset thumbnails.
 */
export const TransitionPreview = memo(function TransitionPreview({
  presentationId,
  direction,
  active,
  className,
}: TransitionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const framesRef = useRef<SampleFrames | null>(null)
  const outRef = useRef<OffscreenCanvas | null>(null)
  const posterProgress = BRIGHT_POSTER_IDS.has(presentationId)
    ? BRIGHT_POSTER_PROGRESS
    : POSTER_PROGRESS

  const draw = useCallback(
    (progress: number) => {
      const canvas = canvasRef.current
      const frames = framesRef.current
      if (!canvas || !frames) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Preferred path: the real WebGPU shaders, for accurate previews. Falls
      // back to the renderer's Canvas 2D path (geometric transitions, or GPU
      // not ready/unavailable).
      if (tryDrawGpuTransitionPreview(ctx, canvas, frames, presentationId, direction, progress)) {
        return
      }
      drawCanvasTransitionPreview(ctx, canvas, frames, presentationId, direction, outRef, progress)
    },
    [presentationId, direction],
  )

  // Decode the sample frames once and paint the poster. Kick off GPU init, then
  // repaint the poster through the real shaders once the pipeline is ready.
  useEffect(() => {
    let cancelled = false
    getSampleFrames().then((frames) => {
      if (cancelled || !frames) return
      framesRef.current = frames
      draw(posterProgress)
      void ensureGpuTransitionPipeline().then(() => {
        if (!cancelled) draw(posterProgress)
      })
    })
    return () => {
      cancelled = true
    }
  }, [draw, posterProgress])

  // Animate while hovered; reset to the poster frame on leave.
  useEffect(() => {
    if (!active) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let start = 0
    const tick = (now: number) => {
      if (!start) start = now
      // Triangle wave 0→1→0 so the loop is seamless (no flash back to A).
      const phase = ((now - start) % (SWEEP_MS * 2)) / SWEEP_MS
      draw(phase <= 1 ? phase : 2 - phase)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      draw(posterProgress)
    }
  }, [active, draw, posterProgress])

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      className={cn('w-full aspect-video rounded-[3px] bg-black/40', className)}
      aria-hidden
    />
  )
})
