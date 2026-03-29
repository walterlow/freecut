import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { useResolvedHotkeys } from '@/features/editor/deps/settings';

interface EditorHotkeyCallbacks {
  onSave?: () => void;
  onExport?: () => void;
}

/**
 * Global editor keyboard shortcuts
 *
 * Handles editor-level shortcuts that work across all components:
 * - Save (Ctrl+S) - Saves timeline to project
 * - Export (Ctrl+Shift+E) - Exports video
 *
 * Note: Undo/Redo are handled in useTimelineShortcuts since they're timeline-specific
 *
 * Uses react-hotkeys-hook with granular Zustand selectors
 */
export function useEditorHotkeys(callbacks: EditorHotkeyCallbacks = {}) {
  const hotkeys = useResolvedHotkeys();

  // Save: Cmd/Ctrl+S
  useHotkeys(
    hotkeys.SAVE,
    (event) => {
      event.preventDefault();
      if (callbacks.onSave) {
        callbacks.onSave();
      }
    },
    HOTKEY_OPTIONS,
    [callbacks.onSave]
  );

  // Export: Cmd/Ctrl+Shift+E
  useHotkeys(
    hotkeys.EXPORT,
    (event) => {
      event.preventDefault();
      if (callbacks.onExport) {
        callbacks.onExport();
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [callbacks.onExport]
  );
}
