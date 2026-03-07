import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import type { EffectsPipeline } from '@/lib/gpu-effects';
import type { GpuEffectInstance } from '@/lib/gpu-effects/types';
import type { GpuEffect, ItemEffect } from '@/types/effects';

function collectGpuEffects(items: { effects?: ItemEffect[] }[]): GpuEffectInstance[] {
  const instances: GpuEffectInstance[] = [];
  for (const item of items) {
    if (!item.effects) continue;
    for (const eff of item.effects) {
      if (eff.enabled && eff.effect.type === 'gpu-effect') {
        const gpuEff = eff.effect as GpuEffect;
        instances.push({
          id: eff.id,
          type: gpuEff.gpuEffectType,
          name: gpuEff.gpuEffectType,
          enabled: true,
          params: { ...gpuEff.params },
        });
      }
    }
  }
  return instances;
}

/**
 * GPU effects overlay — non-blocking for all interactions.
 *
 * Scrubbing: reads from offscreen canvas via dirty flag (zero extra render).
 * Seeking: Player handles the seek instantly, GPU effects catch up async
 *   via captureCanvasSource (progressive — frame shows immediately, effects pop in).
 * Playback: rAF loop with captureCanvasSource at best-effort framerate.
 *
 * Single copyExternalImageToTexture per frame, then stays on GPU.
 */
export function useGpuEffectsOverlay(
  gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  scrubOffscreenRef: React.RefObject<OffscreenCanvas | null>,
  scrubFrameDirtyRef: React.RefObject<boolean>,
) {
  const pipelineRef = useRef<EffectsPipeline | null>(null);
  const gpuCtxRef = useRef<GPUCanvasContext | null>(null);
  const initPromiseRef = useRef<Promise<EffectsPipeline | null> | null>(null);
  const [hasGpuEffects, setHasGpuEffects] = useState(false);

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      setHasGpuEffects(
        items.some((item) => item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect'))
      );
    };
    check();
    return useItemsStore.subscribe(check);
  }, []);

  const ensurePipeline = useCallback(async (): Promise<EffectsPipeline | null> => {
    if (pipelineRef.current) return pipelineRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      try {
        const { EffectsPipeline } = await import('@/lib/gpu-effects');
        const pipeline = await EffectsPipeline.create();
        pipelineRef.current = pipeline;
        return pipeline;
      } catch {
        return null;
      } finally {
        initPromiseRef.current = null;
      }
    })();
    return initPromiseRef.current;
  }, []);

  const applyFromCanvas = useCallback((source: HTMLCanvasElement | OffscreenCanvas) => {
    const canvas = gpuCanvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const items = useItemsStore.getState().items;
    const gpuInstances = collectGpuEffects(items);
    if (gpuInstances.length === 0) return;

    if (!gpuCtxRef.current) {
      gpuCtxRef.current = pipeline.configureCanvas(canvas);
    }
    if (!gpuCtxRef.current) return;

    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
      gpuCtxRef.current = pipeline.configureCanvas(canvas);
      if (!gpuCtxRef.current) return;
    }

    pipeline.applyEffects(source, gpuInstances, gpuCtxRef.current);
  }, [gpuCanvasRef]);

  // Coalesced async render (for seeks, playback, effect changes)
  const asyncInFlightRef = useRef(false);
  const asyncPendingRef = useRef(false);

  const renderAsync = useCallback(() => {
    if (asyncInFlightRef.current) {
      asyncPendingRef.current = true;
      return;
    }
    const captureFn = usePlaybackStore.getState().captureCanvasSource;
    if (!captureFn || !pipelineRef.current) return;

    asyncInFlightRef.current = true;
    captureFn().then((source) => {
      if (source) applyFromCanvas(source);
    }).catch(() => {}).finally(() => {
      asyncInFlightRef.current = false;
      if (asyncPendingRef.current) {
        asyncPendingRef.current = false;
        renderAsync();
      }
    });
  }, [applyFromCanvas]);

  // Main rAF loop: picks up dirty flag from scrub system
  // + drives playback rendering
  useEffect(() => {
    if (!hasGpuEffects) return;

    let active = true;
    let rafId = 0;

    const loop = () => {
      if (!active) return;

      // Scrub system rendered a new frame
      if (scrubFrameDirtyRef.current) {
        scrubFrameDirtyRef.current = false;
        const offscreen = scrubOffscreenRef.current;
        if (offscreen && offscreen.width > 0 && offscreen.height > 0) {
          applyFromCanvas(offscreen);
        }
      }
      // During playback, render at best-effort framerate
      else if (usePlaybackStore.getState().isPlaying) {
        renderAsync();
      }

      rafId = requestAnimationFrame(loop);
    };

    void ensurePipeline().then(() => {
      if (!active) return;
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    };
  }, [hasGpuEffects, ensurePipeline, applyFromCanvas, renderAsync, scrubOffscreenRef, scrubFrameDirtyRef]);

  // Seeking / settled: Player handles the seek instantly,
  // GPU effects catch up async (non-blocking)
  useEffect(() => {
    if (!hasGpuEffects) return;
    let prevFrame = -1;
    return usePlaybackStore.subscribe(() => {
      const s = usePlaybackStore.getState();
      if (s.isPlaying || s.previewFrame !== null) return;
      const frame = s.currentFrame;
      if (frame !== prevFrame) {
        prevFrame = frame;
        renderAsync();
      }
    });
  }, [hasGpuEffects, renderAsync]);

  // Effect param changes while settled
  useEffect(() => {
    if (!hasGpuEffects) return;
    return useItemsStore.subscribe(() => {
      const s = usePlaybackStore.getState();
      if (s.isPlaying || s.previewFrame !== null) return;
      renderAsync();
    });
  }, [hasGpuEffects, renderAsync]);

  // Pre-init pipeline
  useEffect(() => {
    if (hasGpuEffects) void ensurePipeline();
  }, [hasGpuEffects, ensurePipeline]);

  // Cleanup
  useEffect(() => {
    return () => {
      pipelineRef.current?.destroy();
      pipelineRef.current = null;
      gpuCtxRef.current = null;
    };
  }, []);

  return hasGpuEffects;
}
