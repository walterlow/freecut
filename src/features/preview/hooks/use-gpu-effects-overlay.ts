import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import type { EffectsPipeline } from '@/lib/gpu-effects';
import type { GpuEffectInstance } from '@/lib/gpu-effects/types';
import type { GpuEffect, ItemEffect } from '@/types/effects';

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
 * Event-driven: only renders when frame or effects change, not polling.
 * Skips rendering during playback (Player handles that).
 */
export function useGpuEffectsOverlay(gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const pipelineRef = useRef<EffectsPipeline | null>(null);
  const gpuCtxRef = useRef<GPUCanvasContext | null>(null);
  const initPromiseRef = useRef<Promise<EffectsPipeline | null> | null>(null);
  const renderInFlightRef = useRef(false);
  const pendingRenderRef = useRef(false);
  const [hasGpuEffects, setHasGpuEffects] = useState(false);

  // Track whether items have GPU effects
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

  const renderGpuFrame = useCallback(async () => {
    // Coalesce rapid calls — only one render in flight at a time
    if (renderInFlightRef.current) {
      pendingRenderRef.current = true;
      return;
    }
    renderInFlightRef.current = true;

    try {
      const canvas = gpuCanvasRef.current;
      if (!canvas) return;

      // Skip during playback
      if (usePlaybackStore.getState().isPlaying) return;

      const items = useItemsStore.getState().items;
      const gpuInstances = collectGpuEffects(items);
      if (gpuInstances.length === 0) return;

      const captureFn = usePlaybackStore.getState().captureCanvasSource;
      if (!captureFn) return;

      const pipeline = await ensurePipeline();
      if (!pipeline) return;

      if (!gpuCtxRef.current) {
        gpuCtxRef.current = pipeline.configureCanvas(canvas);
      }
      if (!gpuCtxRef.current) return;

      const source = await captureFn();
      if (!source) return;

      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
        gpuCtxRef.current = pipeline.configureCanvas(canvas);
        if (!gpuCtxRef.current) return;
      }

      pipeline.applyEffects(source, gpuInstances, gpuCtxRef.current);
    } catch {
      // Silently continue
    } finally {
      renderInFlightRef.current = false;
      if (pendingRenderRef.current) {
        pendingRenderRef.current = false;
        void renderGpuFrame();
      }
    }
  }, [gpuCanvasRef, ensurePipeline]);

  // Re-render on frame changes (scrubbing, seeking)
  useEffect(() => {
    if (!hasGpuEffects) return;
    let prevFrame = -1;
    return usePlaybackStore.subscribe(() => {
      const s = usePlaybackStore.getState();
      const frame = s.previewFrame ?? s.currentFrame;
      if (frame !== prevFrame && !s.isPlaying) {
        prevFrame = frame;
        void renderGpuFrame();
      }
    });
  }, [hasGpuEffects, renderGpuFrame]);

  // Re-render on effect param changes
  useEffect(() => {
    if (!hasGpuEffects) return;
    return useItemsStore.subscribe(() => void renderGpuFrame());
  }, [hasGpuEffects, renderGpuFrame]);

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
