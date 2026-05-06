import { ProviderRegistry } from '@/shared/utils/provider-registry'
import {
  DEFAULT_SCENE_VERIFICATION_MODEL,
  type SceneVerificationModelId,
} from '@/shared/utils/scene-verification-models'
import { gemmaSceneVerificationProvider } from './gemma-scene-verification-provider'
import { lfmSceneVerificationProvider } from './lfm-scene-verification-provider'
import type { SceneVerificationProvider } from './types'

export { SCENE_VERIFICATION_MODEL_IDS } from '@/shared/utils/scene-verification-models'

export type VerificationModel = SceneVerificationModelId

export const DEFAULT_SCENE_VERIFICATION_PROVIDER_ID: VerificationModel =
  DEFAULT_SCENE_VERIFICATION_MODEL

export const sceneVerificationProviderRegistry = new ProviderRegistry<SceneVerificationProvider>(
  [gemmaSceneVerificationProvider, lfmSceneVerificationProvider],
  DEFAULT_SCENE_VERIFICATION_PROVIDER_ID,
)

export function getDefaultSceneVerificationProvider(): SceneVerificationProvider {
  return sceneVerificationProviderRegistry.getDefault()
}

export function getSceneVerificationProvider(model: VerificationModel): SceneVerificationProvider {
  return sceneVerificationProviderRegistry.get(model)
}

export function getSceneVerificationModelLabel(model: VerificationModel): string {
  return getSceneVerificationProvider(model).label
}

export function getSceneVerificationModelOptions(): readonly {
  value: VerificationModel
  label: string
}[] {
  return sceneVerificationProviderRegistry.list().map((provider) => ({
    value: provider.id as VerificationModel,
    label: provider.label,
  }))
}
