import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import type { EffectsPipeline } from '@/lib/gpu-effects';
import type { GpuEffectInstance } from '@/lib/gpu-effects/types';
import type { GpuEffect, ItemEffect } from '@/types/effects';

const GPU_PREVIEW_INTERVAL_MS = 50; // ~20fps

/**
 * Collect GPU effect instances from all visible items' effects.
 */
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
 * Hook that manages a GPU effects overlay canvas for the preview.
 *
 * When any item has GPU effects, this hook:
 * 1. Lazily initializes the EffectsPipeline
 * 2. Captures the current preview frame via captureCanvasSource
 * 3. Processes it through the GPU pipeline
 * 4. Renders the result to a WebGPU overlay canvas
 */
export function useGpuEffectsOverlay(gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const pipelineRef = useRef<EffectsPipeline | null>(null);
  const gpuCtxRef = useRef<GPUCanvasContext | null>(null);
  const initPromiseRef = useRef<Promise<EffectsPipeline | null> | null>(null);
  const rafRef = useRef<number>(0);
  const lastRenderTimeRef = useRef(0);
  const [hasGpuEffects, setHasGpuEffects] = useState(false);

  // Check if any item has GPU effects
  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      const found = items.some(
        (item) => item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect')
      );
      setHasGpuEffects(found);
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

  // Main render loop
  useEffect(() => {
    if (!hasGpuEffects) return;

    let cancelled = false;

    const renderFrame = async () => {
      if (cancelled) return;

      const now = performance.now();
      if (now - lastRenderTimeRef.current < GPU_PREVIEW_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }
      lastRenderTimeRef.current = now;

      const canvas = gpuCanvasRef.current;
      if (!canvas) {
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      // Collect GPU effects from all items
      const items = useItemsStore.getState().items;
      const gpuInstances = collectGpuEffects(items);
      if (gpuInstances.length === 0) {
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      // Get frame capture function
      const captureFn = usePlaybackStore.getState().captureCanvasSource;
      if (!captureFn) {
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      try {
        const pipeline = await ensurePipeline();
        if (!pipeline || cancelled) return;

        // Configure WebGPU canvas context if needed
        if (!gpuCtxRef.current) {
          gpuCtxRef.current = pipeline.configureCanvas(canvas);
        }
        if (!gpuCtxRef.current) {
          rafRef.current = requestAnimationFrame(renderFrame);
          return;
        }

        // Capture current frame
        const source = await captureFn();
        if (!source || cancelled) {
          rafRef.current = requestAnimationFrame(renderFrame);
          return;
        }

        // Resize overlay canvas to match source
        if (canvas.width !== source.width || canvas.height !== source.height) {
          canvas.width = source.width;
          canvas.height = source.height;
          // Reconfigure after resize
          gpuCtxRef.current = pipeline.configureCanvas(canvas);
          if (!gpuCtxRef.current) {
            rafRef.current = requestAnimationFrame(renderFrame);
            return;
          }
        }

        // Process through GPU pipeline
        pipeline.applyEffects(source, gpuInstances, gpuCtxRef.current);
      } catch {
        // Silently continue on errors
      }

      if (!cancelled) {
        rafRef.current = requestAnimationFrame(renderFrame);
      }
    };

    rafRef.current = requestAnimationFrame(renderFrame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [hasGpuEffects, gpuCanvasRef, ensurePipeline]);

  // Cleanup pipeline on unmount
  useEffect(() => {
    return () => {
      pipelineRef.current?.destroy();
      pipelineRef.current = null;
      gpuCtxRef.current = null;
    };
  }, []);

  return hasGpuEffects;
}
