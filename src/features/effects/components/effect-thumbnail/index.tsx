import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffectInstance } from '@/infrastructure/gpu-effects'
import { cn } from '@/shared/ui/cn'
import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  blendParams,
  ensureEffectPreviewPipeline,
  getEffectPreviewSample,
  getReadyEffectPreviewPipeline,
  getShowcaseParams,
} from './engine'

/** One full original→effect→original sweep in ms; ping-pongs so it never cuts. */
const SWEEP_MS = 1100
/** Resting state shows the effect at full strength so the grid reads at a glance. */
const POSTER_STRENGTH = 1

type EffectParams = Record<string, number | boolean | string>

/** A single effect in the preview chain, with the params to sweep toward. */
interface PreviewSpec {
  gpuEffectType: string
  target: EffectParams
}

interface EffectThumbnailProps {
  /** Single GPU effect by registry id. Showcase params are derived. */
  effectId?: string
  /**
   * An explicit effect chain (e.g. a preset). Each entry's params are the
   * sweep target. Pass a referentially stable array so the thumbnail can memoize.
   */
  effects?: ReadonlyArray<{ gpuEffectType: string; params: EffectParams }>
  /** True while the host row is hovered — drives the animation loop. */
  active: boolean
  className?: string
}

/**
 * A small canvas that previews a GPU effect over a bundled sample frame.
 * Renders through the real WebGPU `EffectsPipeline` for true fidelity: idle at
 * full strength, sweeping strength 0 → full → 0 while `active` (hovered),
 * mirroring the transition-picker previews.
 */
export const EffectThumbnail = memo(function EffectThumbnail({
  effectId,
  effects,
  active,
  className,
}: EffectThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sampleRef = useRef<OffscreenCanvas | null>(null)

  const specs = useMemo<PreviewSpec[]>(() => {
    if (effects) {
      return effects.map((e) => ({ gpuEffectType: e.gpuEffectType, target: e.params }))
    }
    if (effectId) {
      const def = getGpuEffect(effectId)
      if (def) return [{ gpuEffectType: effectId, target: getShowcaseParams(def) }]
    }
    return []
  }, [effectId, effects])

  const draw = useCallback(
    (strength: number) => {
      const canvas = canvasRef.current
      const sample = sampleRef.current
      if (!canvas || !sample) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const pipeline = getReadyEffectPreviewPipeline()
      if (pipeline && specs.length > 0) {
        const instances: GpuEffectInstance[] = specs.map((spec, i) => ({
          id: `preview-${i}`,
          type: spec.gpuEffectType,
          name: spec.gpuEffectType,
          enabled: true,
          params: blendParams(spec.gpuEffectType, spec.target, strength),
        }))
        const result = pipeline.applyEffectsToCanvas(sample, instances)
        if (result) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(result, 0, 0, canvas.width, canvas.height)
          return
        }
      }

      // Fallback: paint the raw sample (pipeline not ready / unavailable).
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(sample, 0, 0, canvas.width, canvas.height)
    },
    [specs],
  )

  // Decode the sample once and paint the poster. Kick off GPU init, then repaint
  // the poster through the real shaders once the pipeline is ready.
  useEffect(() => {
    let cancelled = false
    getEffectPreviewSample().then((sample) => {
      if (cancelled || !sample) return
      sampleRef.current = sample
      draw(POSTER_STRENGTH)
      void ensureEffectPreviewPipeline().then(() => {
        if (!cancelled) draw(POSTER_STRENGTH)
      })
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
      // Triangle wave 0→1→0 so the loop is seamless (no flash back to original).
      const phase = ((now - start) % (SWEEP_MS * 2)) / SWEEP_MS
      draw(phase <= 1 ? phase : 2 - phase)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      draw(POSTER_STRENGTH)
    }
  }, [active, draw])

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      className={cn('bg-black/40', className)}
      draggable={false}
      aria-hidden
    />
  )
})
