/**
 * Dopesheet hotkey registration.
 * Every editing shortcut the sheet owns is registered here, next to the pure
 * helpers that resolve and dispatch them, so the editor body stays free of the
 * ten identical `useHotkeys` blocks. Registration order is the order the
 * bindings were installed in before the extraction.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import {
  handleAddKeyframeHotkey,
  handleDeleteHotkey,
  handleFitKeyframesHotkey,
  handleNavigateHotkey,
  handleNudgeHotkey,
  handleToggleAutoKeyHotkey,
  resolveDopesheetHotkeys,
  type DopesheetShortcutMap,
} from './dopesheet-hotkeys'
import type { DopesheetPropertyRow } from './dopesheet-types'

export interface UseDopesheetHotkeysOptions {
  /** Activate editor-only shortcuts when this surface owns pointer or keyboard focus. */
  shortcutsEnabled: boolean
  /** Keep the Edit add-keyframe shortcut active while its dock is open. */
  addKeyframeShortcutEnabled: boolean
  disabled: boolean
  /** User-configurable bindings for high-frequency keyframe actions. */
  shortcuts?: DopesheetShortcutMap | undefined
  /** The selected property's row, when it is visible. */
  activePropertyRow: DopesheetPropertyRow | undefined
  hasSelection: boolean
  /** Whether the owner can commit value edits (gates the auto-key shortcut). */
  canCommitValues: boolean
  selectedRefs: KeyframeRef[]
  onRemoveKeyframes?: ((refs: KeyframeRef[]) => void) | undefined
  handleRowAddKeyframe: (property: AnimatableProperty, currentKeyframes: Keyframe[]) => void
  handleRowNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void
  handleRowAutoKeyToggle: (property: AnimatableProperty) => void
  fitKeyframesInView: () => void
  nudgeSelectedKeyframes: (deltaFrames: number) => void
}

/** Registers every dopesheet shortcut. Returns nothing; the bindings are the output. */
export function useDopesheetHotkeys({
  shortcutsEnabled,
  addKeyframeShortcutEnabled,
  disabled,
  shortcuts,
  activePropertyRow,
  hasSelection,
  canCommitValues,
  selectedRefs,
  onRemoveKeyframes,
  handleRowAddKeyframe,
  handleRowNavigate,
  handleRowAutoKeyToggle,
  fitKeyframesInView,
  nudgeSelectedKeyframes,
}: UseDopesheetHotkeysOptions): void {
  const hotkeyBindings = resolveDopesheetHotkeys({
    shortcutsEnabled,
    addKeyframeShortcutEnabled,
    disabled,
    shortcuts,
    hasActivePropertyRow: !!activePropertyRow,
    hasSelection,
    canCommitValues,
  })

  useHotkeys(
    hotkeyBindings.keys.add,
    (event) => handleAddKeyframeHotkey(event, activePropertyRow, handleRowAddKeyframe),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.add,
    },
    [hotkeyBindings.keys.add, hotkeyBindings.enabled.add, activePropertyRow, handleRowAddKeyframe],
  )

  useHotkeys(
    hotkeyBindings.keys.prev,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.prevKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.prev,
    },
    [hotkeyBindings.keys.prev, hotkeyBindings.enabled.prev, activePropertyRow, handleRowNavigate],
  )

  useHotkeys(
    hotkeyBindings.keys.next,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.nextKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.next,
    },
    [hotkeyBindings.keys.next, hotkeyBindings.enabled.next, activePropertyRow, handleRowNavigate],
  )

  useHotkeys(
    hotkeyBindings.keys.toggleAutoKey,
    (event) => handleToggleAutoKeyHotkey(event, activePropertyRow, handleRowAutoKeyToggle),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.toggleAutoKey,
    },
    [
      hotkeyBindings.keys.toggleAutoKey,
      hotkeyBindings.enabled.toggleAutoKey,
      activePropertyRow,
      handleRowAutoKeyToggle,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.fit,
    (event) => handleFitKeyframesHotkey(event, fitKeyframesInView),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.fit,
    },
    [hotkeyBindings.keys.fit, hotkeyBindings.enabled.fit, fitKeyframesInView],
  )

  useHotkeys(
    'delete,backspace',
    (event) => handleDeleteHotkey(event, selectedRefs, onRemoveKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, selectedRefs, onRemoveKeyframes],
  )

  useHotkeys(
    'left',
    (event) => handleNudgeHotkey(event, -1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'right',
    (event) => handleNudgeHotkey(event, 1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+left',
    (event) => handleNudgeHotkey(event, -10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+right',
    (event) => handleNudgeHotkey(event, 10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )
}
