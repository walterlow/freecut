import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';

/**
 * Global editor keyboard shortcuts
 *
 * Handles editor-level shortcuts that work across all components:
 * - Save/Export (when implemented)
 * - Other global actions
 *
 * Note: Undo/Redo are handled in useTimelineShortcuts since they're timeline-specific
 *
 * Uses react-hotkeys-hook with granular Zustand selectors
 */
export function useEditorHotkeys() {
  // Save: Cmd/Ctrl+S
  // TODO: Implement save functionality
  useHotkeys(
    HOTKEYS.SAVE,
    (event) => {
      event.preventDefault();
      console.log('Save project (not implemented)');
      // Future: Call project save action
    },
    HOTKEY_OPTIONS
  );

  // Export: Cmd/Ctrl+E
  // TODO: Implement export functionality
  useHotkeys(
    HOTKEYS.EXPORT,
    (event) => {
      event.preventDefault();
      console.log('Export project (not implemented)');
      // Future: Call export action
    },
    HOTKEY_OPTIONS
  );
}
