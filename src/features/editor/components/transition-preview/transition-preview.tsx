import { memo, useCallback, useEffect, useRef } from 'react'
import { transitionRegistry } from '@/shared/timeline/transitions'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import type { WipeDirection, SlideDirection, FlipDirection } from '@/types/transition'
import { getSampleFrames, PREVIEW_WIDTH, PREVIEW_HEIGHT, type SampleFrames } from './sample-frames'

const log = createLogger('TransitionPreview')

/** One full A→B sweep in ms; the loop ping-pongs so the dissolve never hard-cuts. */
const SWEEP_MS = 1100
/** Resting progress — mid-transition so an idle card still shows its character. */
const POSTER_PROGRESS = 0.5

interface TransitionPreviewProps {
  /** Presentation id registered in the transition registry (e.g. 'dissolve'). */
  presentationId: string
  /** Direction for directional transitions (wipe/slide/flip); omit otherwise. */
  direction?: WipeDirection | SlideDirection | FlipDirection
  /** True while the host card is hovered — drives the animation loop. */
  active: boolean
  className?: string
}

/**
 * A small canvas that previews a transition by running the *real* renderer
 * (`renderCanvas`) over two contrasting sample stills. Idle at rest showing a
 * mid-transition poster frame; animates only while `active` (hovered), mirroring
 * the on-hover motion-preset thumbnails.
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

  const draw = useCallback(
    (progress: number) => {
      const canvas = canvasRef.current
      const frames = framesRef.current
      if (!canvas || !frames) return

      const renderer = transitionRegistry.getRenderer(presentationId)
      if (!renderer?.renderCanvas) return

      const out = (outRef.current ??= new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT))
      const outCtx = out.getContext('2d')
      const ctx = canvas.getContext('2d')
      if (!outCtx || !ctx) return

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
    },
    [presentationId, direction],
  )

  // Decode the sample frames once, then paint the resting poster frame.
  useEffect(() => {
    let cancelled = false
    getSampleFrames().then((frames) => {
      if (cancelled || !frames) return
      framesRef.current = frames
      draw(POSTER_PROGRESS)
    })
    return () => {
      cancelled = true
    }
  }, [draw])

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
      draw(POSTER_PROGRESS)
    }
  }, [active, draw])

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
