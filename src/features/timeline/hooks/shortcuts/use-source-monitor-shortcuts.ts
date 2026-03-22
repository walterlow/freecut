/**
 * Source Monitor shortcuts (global):
 *   , (Insert Edit), . (Overwrite Edit)
 *
 * These work globally as long as the source monitor is open.
 *
 * Mark In/Out/Clear (I, O, Alt+X) are handled locally inside the
 * SourceMonitor component via onKeyDown so they only fire when the
 * source monitor is hovered/focused.
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { useEditorStore } from '@/shared/state/editor';
import { performInsertEdit, performOverwriteEdit } from '../../stores/actions/source-edit-actions';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';

export function useSourceMonitorShortcuts() {
  const hotkeys = useResolvedHotkeys();

  // Insert Edit: , (comma) — works globally when source monitor is open
  useHotkeys(
    hotkeys.INSERT_EDIT,
    (event) => {
      event.preventDefault();
      const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId;
      if (!sourceMediaId) return;
      performInsertEdit();
    },
    HOTKEY_OPTIONS,
    []
  );

  // Overwrite Edit: . (period) — works globally when source monitor is open
  useHotkeys(
    hotkeys.OVERWRITE_EDIT,
    (event) => {
      event.preventDefault();
      const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId;
      if (!sourceMediaId) return;
      performOverwriteEdit();
    },
    HOTKEY_OPTIONS,
    []
  );
}
