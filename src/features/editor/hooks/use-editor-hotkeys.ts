import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';

interface EditorHotkeyCallbacks {
  onSave?: () => void;
  onExport?: () => void;
}

/**
 * Global editor keyboard shortcuts
 *
 * Handles editor-level shortcuts that work across all components:
 * - Save (Ctrl+S) - Saves timeline to project
 * - Export (Ctrl+E) - Exports video
 *
 * Note: Undo/Redo are handled in useTimelineShortcuts since they're timeline-specific
 *
 * Uses react-hotkeys-hook with granular Zustand selectors
 */
export function useEditorHotkeys(callbacks: EditorHotkeyCallbacks = {}) {
  // Save: Cmd/Ctrl+S
  useHotkeys(
    HOTKEYS.SAVE,
    (event) => {
      event.preventDefault();
      if (callbacks.onSave) {
        callbacks.onSave();
      }
    },
    HOTKEY_OPTIONS,
    [callbacks.onSave]
  );

  // Export: Cmd/Ctrl+E — use capture phase to beat Chrome's Ctrl+E (address bar)
  useHotkeys(
    HOTKEYS.EXPORT,
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
