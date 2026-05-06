const MB = 1024 * 1024

export const MUSICGEN_MODEL_IDS = ['musicgen-small'] as const

export type MusicgenModelId = (typeof MUSICGEN_MODEL_IDS)[number]

export interface MusicgenModelDefinition {
  id: MusicgenModelId
  label: string
  modelId: string
  downloadLabel: string
  estimatedBytes: number
  cacheMatchFragments: readonly string[]
  defaultDurationSeconds: number
  minDurationSeconds: number
  maxDurationSeconds: number
  tokensPerSecond: number
}

export const DEFAULT_MUSICGEN_MODEL: MusicgenModelId = 'musicgen-small'

export const MUSICGEN_MODEL_DEFINITIONS: Record<MusicgenModelId, MusicgenModelDefinition> = {
  'musicgen-small': {
    id: 'musicgen-small',
    label: 'MusicGen Small',
    modelId: 'Xenova/musicgen-small',
    downloadLabel: '~742 MB',
    estimatedBytes: 742 * MB,
    cacheMatchFragments: ['/xenova/musicgen-small/'],
    defaultDurationSeconds: 8,
    minDurationSeconds: 2,
    maxDurationSeconds: 30,
    tokensPerSecond: 50,
  },
}

export const MUSICGEN_MODEL_OPTIONS: ReadonlyArray<{
  value: MusicgenModelId
  label: string
  downloadLabel: string
  estimatedBytes: number
}> = MUSICGEN_MODEL_IDS.map((id) => {
  const definition = MUSICGEN_MODEL_DEFINITIONS[id]
  return {
    value: definition.id,
    label: definition.label,
    downloadLabel: definition.downloadLabel,
    estimatedBytes: definition.estimatedBytes,
  }
})

export function getMusicgenModelDefinition(model: MusicgenModelId): MusicgenModelDefinition {
  return MUSICGEN_MODEL_DEFINITIONS[model]
}

export function getMusicgenMaxNewTokens(model: MusicgenModelId, durationSeconds: number): number {
  const definition = getMusicgenModelDefinition(model)
  return Math.max(1, Math.round(durationSeconds * definition.tokensPerSecond))
}
