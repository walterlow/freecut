import { createLfmSceneWorker } from '../create-lfm-worker'
import { createSingletonSceneVerificationProvider } from './singleton-worker-provider'
import { SCENE_VERIFICATION_MODEL_LABELS } from '@/shared/utils/scene-verification-models'

export const lfmSceneVerificationProvider = createSingletonSceneVerificationProvider({
  id: 'lfm',
  label: SCENE_VERIFICATION_MODEL_LABELS.lfm,
  createWorker: createLfmSceneWorker,
})
