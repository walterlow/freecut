export interface EffectParam {
  type: 'number' | 'boolean' | 'select' | 'color' | 'point';
  label: string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  animatable?: boolean;
  quality?: boolean;
}

export interface GpuEffectDefinition {
  id: string;
  name: string;
  category: GpuEffectCategory;
  shader: string;
  entryPoint: string;
  uniformSize: number;
  params: Record<string, EffectParam>;
  packUniforms: (
    params: Record<string, number | boolean | string>,
    width: number,
    height: number,
  ) => Float32Array | null;
}

export type GpuEffectCategory = 'color' | 'blur' | 'distort' | 'stylize' | 'keying';

export interface GpuEffectInstance {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
}
