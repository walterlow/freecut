import type { GpuTransitionDefinition } from './types';
export type { GpuTransitionDefinition } from './types';
export { TransitionPipeline } from './transition-pipeline';

import { dissolve } from './transitions/dissolve';
import { sparkles } from './transitions/sparkles';
import { glitch } from './transitions/glitch';
import { lightLeak } from './transitions/light-leak';
import { pixelate } from './transitions/pixelate';
import { chromatic } from './transitions/chromatic';
import { radialBlur } from './transitions/radial-blur';
import { fade } from './transitions/fade';
import { wipe } from './transitions/wipe';
import { slide } from './transitions/slide';
import { flip } from './transitions/flip';
import { clockWipe } from './transitions/clock-wipe';
import { iris } from './transitions/iris';

export const GPU_TRANSITION_REGISTRY = new Map<string, GpuTransitionDefinition>();

function register(def: GpuTransitionDefinition) {
  GPU_TRANSITION_REGISTRY.set(def.id, def);
}

register(dissolve);
register(sparkles);
register(glitch);
register(lightLeak);
register(pixelate);
register(chromatic);
register(radialBlur);
register(fade);
register(wipe);
register(slide);
register(flip);
register(clockWipe);
register(iris);

export function getGpuTransition(id: string): GpuTransitionDefinition | undefined {
  return GPU_TRANSITION_REGISTRY.get(id);
}

export function getGpuTransitionIds(): string[] {
  return Array.from(GPU_TRANSITION_REGISTRY.keys());
}
