/**
 * Daydream Scope pipeline definitions.
 * Each pipeline has a VRAM requirement; the UI disables options that exceed available GPU memory.
 */

export interface ScopePipeline {
  id: string;
  label: string;
  description: string;
  vramRequired: number; // in GB
  category: 'realtime' | 'interpolation';
}

export const SCOPE_PIPELINES: ScopePipeline[] = [
  {
    id: 'streamdiffusion-v2',
    label: 'StreamDiffusion V2',
    description: 'Fast real-time text-to-video and video-to-video. Best for live feedback.',
    vramRequired: 24,
    category: 'realtime',
  },
  {
    id: 'longlive',
    label: 'LongLive',
    description: 'High-quality video generation with temporal consistency.',
    vramRequired: 24,
    category: 'interpolation',
  },
  {
    id: 'krea-realtime',
    label: 'Krea Realtime',
    description: 'Ultra-fast generation using fp8 quantization. Requires 32GB+ VRAM.',
    vramRequired: 32,
    category: 'realtime',
  },
  {
    id: 'rewardforcing',
    label: 'RewardForcing',
    description: 'Reward-guided video generation for higher aesthetic quality.',
    vramRequired: 24,
    category: 'interpolation',
  },
  {
    id: 'memflow',
    label: 'MemFlow',
    description: 'Memory-efficient video-to-video with optical flow guidance.',
    vramRequired: 24,
    category: 'interpolation',
  },
];

export function getRealtimePipelines(): ScopePipeline[] {
  return SCOPE_PIPELINES.filter((p) => p.category === 'realtime');
}

export function getInterpolationPipelines(): ScopePipeline[] {
  return SCOPE_PIPELINES.filter((p) => p.category === 'interpolation');
}

export function getPipelineById(id: string): ScopePipeline | undefined {
  return SCOPE_PIPELINES.find((p) => p.id === id);
}

export function isPipelineFeasible(pipeline: ScopePipeline, availableVram: number): boolean {
  return availableVram >= pipeline.vramRequired;
}
