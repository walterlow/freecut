import { useMemo } from 'react'
import { getGpuCategoriesWithEffects } from '@/infrastructure/gpu-effects'
import { EFFECT_PRESETS } from '@/types/effects'
import { useEffectPreviews } from './use-effect-previews'

export function useGpuEffectPreviewData() {
  const gpuCategories = useMemo(() => getGpuCategoriesWithEffects(), [])
  const allEffectEntries = useMemo(
    () =>
      gpuCategories.flatMap(({ effects: catEffects }) =>
        catEffects.map((def) => ({ id: def.id, def })),
      ),
    [gpuCategories],
  )
  const presetIds = useMemo(() => EFFECT_PRESETS.map((p) => p.id), [])
  const { previews: effectPreviews, trigger: triggerPreviews } = useEffectPreviews(
    allEffectEntries,
    presetIds,
  )

  return { gpuCategories, effectPreviews, triggerPreviews }
}
