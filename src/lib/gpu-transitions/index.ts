import type { GpuTransitionDefinition } from './types';
export type { GpuTransitionDefinition } from './types';
export { TransitionPipeline } from './transition-pipeline';

import { dissolve } from './transitions/dissolve';
import { glitch } from './transitions/glitch';
import { lightLeak } from './transitions/light-leak';

export const GPU_TRANSITION_REGISTRY = new Map<string, GpuTransitionDefinition>();

function register(def: GpuTransitionDefinition) {
  GPU_TRANSITION_REGISTRY.set(def.id, def);
}

register(dissolve);
register(glitch);
register(lightLeak);

export function getGpuTransition(id: string): GpuTransitionDefinition | undefined {
  return GPU_TRANSITION_REGISTRY.get(id);
}

export function getGpuTransitionIds(): string[] {
  return Array.from(GPU_TRANSITION_REGISTRY.keys());
}
