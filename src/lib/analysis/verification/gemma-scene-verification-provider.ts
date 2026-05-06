import { createGemmaSceneWorker } from '../create-gemma-worker'
import { createSingletonSceneVerificationProvider } from './singleton-worker-provider'
import { SCENE_VERIFICATION_MODEL_LABELS } from '@/shared/utils/scene-verification-models'

export const gemmaSceneVerificationProvider = createSingletonSceneVerificationProvider({
  id: 'gemma',
  label: SCENE_VERIFICATION_MODEL_LABELS.gemma,
  createWorker: createGemmaSceneWorker,
})
