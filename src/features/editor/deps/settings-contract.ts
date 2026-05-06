/**
 * Adapter exports for settings dependencies.
 * Editor modules should import settings stores/services from here.
 */

export {
  useSettingsStore,
  CAPTIONING_INTERVAL_BOUNDS,
  DEFAULT_CAPTIONING_INTERVAL_SECONDS,
  resolveCaptioningIntervalSec,
} from '@/features/settings/stores/settings-store'
export type { CaptioningIntervalUnit } from '@/features/settings/stores/settings-store'
export { LocalInferenceUnloadControl } from '@/features/settings/components/local-inference-unload-control'
export { LocalModelCacheControl } from '@/features/settings/components/local-model-cache-control'
export { useResolvedHotkeys } from '@/features/settings/hooks/use-resolved-hotkeys'
export { HotkeyEditor } from '@/features/settings/components/hotkey-editor'
