/**
 * Effect Preview Thumbnails
 *
 * Lazily renders a GPU preview thumbnail for each effect in the registry.
 * Uses a separate EffectsPipeline instance to avoid interfering with the
 * main preview pipeline.
 *
 * Generation is deferred until explicitly triggered (on first dropdown open).
 * Results are cached as blob URLs — effects are static so previews
 * only need to be generated once per session.
 */

import { useState, useCallback, useRef } from 'react';
import { EffectsPipeline } from '@/infrastructure/gpu/effects';
import type { GpuEffectInstance, GpuEffectDefinition } from '@/infrastructure/gpu/effects';
import { EFFECT_PRESETS } from '@/types/effects';

const PREVIEW_WIDTH = 80;
const PREVIEW_HEIGHT = 45;

// Module-level cache — persists across component mounts
const previewCache = new Map<string, string>();
let pipelineInstance: EffectsPipeline | null = null;
let pipelinePromise: Promise<EffectsPipeline | null> | null = null;

async function getOrCreatePipeline(): Promise<EffectsPipeline | null> {
  if (pipelineInstance) return pipelineInstance;
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = EffectsPipeline.create();
  pipelineInstance = await pipelinePromise;
  pipelinePromise = null;
  return pipelineInstance;
}

/**
 * Create a sample source canvas with a gradient that showcases
 * color, brightness, and saturation changes clearly.
 */
function createSampleCanvas(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const ctx = canvas.getContext('2d')!;

  // Diagonal gradient: warm orange → red → blue → green
  const grad = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  grad.addColorStop(0, '#e8a960');
  grad.addColorStop(0.3, '#d45d5d');
  grad.addColorStop(0.6, '#5b8fbf');
  grad.addColorStop(1, '#4aab7a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  // Subtle vignette for depth
  const radial = ctx.createRadialGradient(
    PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2, PREVIEW_HEIGHT * 0.3,
    PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2, PREVIEW_WIDTH * 0.7,
  );
  radial.addColorStop(0, 'rgba(255,255,255,0.1)');
  radial.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  return canvas;
}

/**
 * Compute "showcase" params that make an effect visually obvious.
 * Defaults are often identity (no visible effect), so we push params
 * toward a visible range.
 */
function getShowcaseParams(def: GpuEffectDefinition): Record<string, number | boolean | string> {
  const params: Record<string, number | boolean | string> = {};

  for (const [key, param] of Object.entries(def.params)) {
    if (param.type === 'number') {
      const min = param.min ?? 0;
      const max = param.max ?? 1;
      const dflt = param.default as number;

      if (dflt === min) {
        // Default is at min — push 30% toward max
        params[key] = min + (max - min) * 0.3;
      } else if (dflt === max) {
        // Default is at max — keep it (e.g., grayscale amount=1)
        params[key] = dflt;
      } else {
        // Default is in middle — push 30% toward max
        params[key] = dflt + (max - dflt) * 0.3;
      }
    } else {
      params[key] = param.default;
    }
  }

  return params;
}

/**
 * Render a single effect onto the source canvas and return a blob URL.
 */
async function renderEffectPreview(
  pipeline: EffectsPipeline,
  source: OffscreenCanvas,
  effectId: string,
  def: GpuEffectDefinition,
): Promise<string | null> {
  const params = getShowcaseParams(def);
  const instance: GpuEffectInstance = {
    id: 'preview',
    type: effectId,
    name: def.name,
    enabled: true,
    params,
  };

  const result = pipeline.applyEffectsToCanvas(source, [instance]);
  if (!result) return null;

  // Snapshot the GPU output before the next call overwrites it
  const bitmap = await createImageBitmap(result);
  const out = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return URL.createObjectURL(blob);
}

/**
 * Render a preset (chain of effects) and return a blob URL.
 */
async function renderPresetPreview(
  pipeline: EffectsPipeline,
  source: OffscreenCanvas,
  presetId: string,
): Promise<string | null> {
  const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;

  const instances: GpuEffectInstance[] = preset.effects.map((e, i) => ({
    id: `preset-${i}`,
    type: e.gpuEffectType,
    name: e.gpuEffectType,
    enabled: true,
    params: e.params,
  }));

  const result = pipeline.applyEffectsToCanvas(source, instances);
  if (!result) return null;

  const bitmap = await createImageBitmap(result);
  const out = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return URL.createObjectURL(blob);
}

export interface EffectPreviewEntry {
  id: string;
  def: GpuEffectDefinition;
}

/**
 * Hook that generates GPU-rendered preview thumbnails for effects.
 *
 * Returns a Map of effect/preset ID → blob URL, plus a trigger function.
 * Call `trigger()` on first dropdown open to start generation lazily.
 * Results are cached globally — subsequent mounts return instantly.
 */
export function useEffectPreviews(
  effects: EffectPreviewEntry[],
  presetIds: string[],
): { previews: Map<string, string>; trigger: () => void } {
  const [previews, setPreviews] = useState<Map<string, string>>(() => {
    // Populate from module-level cache on mount
    const cached = new Map<string, string>();
    for (const { id } of effects) {
      const url = previewCache.get(id);
      if (url) cached.set(id, url);
    }
    for (const id of presetIds) {
      const url = previewCache.get(`preset:${id}`);
      if (url) cached.set(`preset:${id}`, url);
    }
    return cached;
  });

  const generatingRef = useRef(false);

  const trigger = useCallback(() => {
    const allIds = [
      ...effects.map(({ id }) => id),
      ...presetIds.map((id) => `preset:${id}`),
    ];
    const missing = allIds.filter((id) => !previewCache.has(id));
    if (missing.length === 0 || generatingRef.current) return;

    generatingRef.current = true;

    (async () => {
      const pipeline = await getOrCreatePipeline();
      if (!pipeline) {
        generatingRef.current = false;
        return;
      }

      const source = createSampleCanvas();

      for (const { id, def } of effects) {
        if (previewCache.has(id)) continue;
        const url = await renderEffectPreview(pipeline, source, id, def);
        if (url) previewCache.set(id, url);
      }

      for (const presetId of presetIds) {
        const cacheKey = `preset:${presetId}`;
        if (previewCache.has(cacheKey)) continue;
        const url = await renderPresetPreview(pipeline, source, presetId);
        if (url) previewCache.set(cacheKey, url);
      }

      const result = new Map<string, string>();
      for (const id of allIds) {
        const url = previewCache.get(id);
        if (url) result.set(id, url);
      }
      setPreviews(result);
      generatingRef.current = false;
    })();
  }, [effects, presetIds]);

  return { previews, trigger };
}
