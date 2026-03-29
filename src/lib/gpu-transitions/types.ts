import type { TransitionCategory } from '@/types/transition';

export interface GpuTransitionDefinition {
  id: string;
  name: string;
  category: TransitionCategory;
  shader: string;
  entryPoint: string;
  /** Total uniform buffer size in bytes (must be multiple of 16) */
  uniformSize: number;
  hasDirection: boolean;
  directions?: string[];
  /** Pack progress + custom params into a Float32Array for the uniform buffer */
  packUniforms: (
    progress: number,
    width: number,
    height: number,
    direction: number,
    properties?: Record<string, unknown>,
  ) => Float32Array;
}
