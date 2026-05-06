export const SCENE_VERIFICATION_MODEL_IDS = ['gemma', 'lfm'] as const

export type SceneVerificationModelId = (typeof SCENE_VERIFICATION_MODEL_IDS)[number]

export const DEFAULT_SCENE_VERIFICATION_MODEL: SceneVerificationModelId = 'gemma'

export const SCENE_VERIFICATION_MODEL_LABELS: Record<SceneVerificationModelId, string> = {
  gemma: 'Gemma',
  lfm: 'LFM',
}

export const SCENE_VERIFICATION_MODEL_CACHE_MATCH_FRAGMENTS: Record<
  SceneVerificationModelId,
  readonly string[]
> = {
  gemma: ['/onnx-community/gemma-4-e4b-it-onnx/'],
  lfm: ['/liquidai/lfm2.5-vl-450m-onnx/'],
}

export const SCENE_VERIFICATION_MODEL_CACHE_DESCRIPTIONS: Record<SceneVerificationModelId, string> =
  {
    gemma: 'Gemma scene-detection ONNX model files and processor assets.',
    lfm: 'LFM 2.5 VL scene-detection ONNX model files and processor assets.',
  }

export const SCENE_VERIFICATION_MODEL_OPTIONS = SCENE_VERIFICATION_MODEL_IDS.map((value) => ({
  value,
  label: SCENE_VERIFICATION_MODEL_LABELS[value],
})) satisfies ReadonlyArray<{
  value: SceneVerificationModelId
  label: string
}>
