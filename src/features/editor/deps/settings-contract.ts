/**
 * Adapter exports for settings dependencies.
 * Editor modules should import settings stores/services from here.
 */

export { useSettingsStore } from '@/features/settings/stores/settings-store';
export { LocalInferenceUnloadControl } from '@/features/settings/components/local-inference-unload-control';
export { useResolvedHotkeys } from '@/features/settings/hooks/use-resolved-hotkeys';
export { HotkeyEditor } from '@/features/settings/components/hotkey-editor';
