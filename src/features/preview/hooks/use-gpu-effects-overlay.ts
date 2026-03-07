import { useCallback, useEffect, useRef, useState } from 'react';
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
 * GPU effects overlay — WebGPU-native approach inspired by masterselects engine.
 *
 * Instead of CPU composition renders, captures directly from the Player's
 * <video> element via copyExternalImageToTexture (near-zero-copy GPU capture).
 * Effects run as GPU render passes. No CPU readback, no composition render.
 *
 * Scrubbing: offscreen canvas dirty flag (scrub renderer already rendered).
 * Seeking/settled/param changes: reads directly from <video> element in DOM.
 * Playback: rAF loop reads from <video> element every frame.
 */
export function useGpuEffectsOverlay(
  gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  playerContainerRef: React.RefObject<HTMLDivElement | null>,
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

  // Apply GPU effects from any valid source (video element, canvas, offscreen canvas)
  const applyFromSource = useCallback((source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas) => {
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

    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gpuCtxRef.current = pipeline.configureCanvas(canvas);
      if (!gpuCtxRef.current) return;
    }

    pipeline.applyEffects(source, gpuInstances, gpuCtxRef.current);
  }, [gpuCanvasRef]);

  // Find a usable <video> element inside the Player container
  const findVideoElement = useCallback((): HTMLVideoElement | null => {
    const container = playerContainerRef.current;
    if (!container) return null;
    const videos = container.querySelectorAll('video');
    for (const video of videos) {
      // readyState >= 2 = HAVE_CURRENT_DATA (has at least one decoded frame)
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        return video;
      }
    }
    return null;
  }, [playerContainerRef]);

  // Main rAF loop — WebGPU-native: reads from video element or offscreen canvas
  useEffect(() => {
    if (!hasGpuEffects) return;

    let active = true;
    let rafId = 0;

    const loop = () => {
      if (!active) return;

      // Priority 1: scrub system dirty flag (scrub renderer already rendered to offscreen)
      if (scrubFrameDirtyRef.current) {
        scrubFrameDirtyRef.current = false;
        const offscreen = scrubOffscreenRef.current;
        if (offscreen && offscreen.width > 0 && offscreen.height > 0) {
          applyFromSource(offscreen);
        }
      } else {
        // Priority 2: capture directly from <video> element — zero composition render
        // Works for: seeking, playback, param changes, idle
        // copyExternalImageToTexture from <video> is near-zero-copy (GPU DMA)
        const video = findVideoElement();
        if (video) {
          applyFromSource(video);
        }
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
  }, [hasGpuEffects, ensurePipeline, applyFromSource, findVideoElement, scrubOffscreenRef, scrubFrameDirtyRef]);

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
