import type { AnimatableProperty } from '@/types/keyframe';

type KeyframeEditorModeLike = 'graph' | 'dopesheet' | 'split';

export function resolveKeyframeEditorHotkeyProperty(
  editorMode: KeyframeEditorModeLike,
  selectedProperty: AnimatableProperty | null,
  availableProperties: AnimatableProperty[],
  activeDopesheetProperty: AnimatableProperty | null
): AnimatableProperty | null {
  const displayedGraphProperty =
    selectedProperty && availableProperties.includes(selectedProperty)
      ? selectedProperty
      : availableProperties[0] ?? null;

  if (editorMode === 'dopesheet') {
    if (selectedProperty && availableProperties.includes(selectedProperty)) {
      return selectedProperty;
    }

    return activeDopesheetProperty && availableProperties.includes(activeDopesheetProperty)
      ? activeDopesheetProperty
      : null;
  }

  return displayedGraphProperty;
}
