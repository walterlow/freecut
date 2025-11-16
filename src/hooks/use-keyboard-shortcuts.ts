import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  callback: () => void;
  description?: string;
}

/**
 * Generic keyboard shortcuts hook using react-hotkeys-hook
 *
 * Provides a declarative way to register multiple keyboard shortcuts.
 * Automatically handles cross-platform modifiers and prevents shortcuts in form inputs.
 *
 * @param shortcuts - Array of keyboard shortcut configurations
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts([
 *   { key: 's', ctrlKey: true, callback: () => save() },
 *   { key: 'Escape', callback: () => close() }
 * ]);
 * ```
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  shortcuts.forEach((shortcut) => {
    const { key, ctrlKey, shiftKey, altKey, metaKey, callback } = shortcut;

    // Build hotkey string (react-hotkeys-hook format)
    const modifiers: string[] = [];
    if (metaKey) modifiers.push('meta');
    if (ctrlKey) modifiers.push('ctrl');
    if (altKey) modifiers.push('alt');
    if (shiftKey) modifiers.push('shift');

    const hotkeyString = modifiers.length > 0
      ? `${modifiers.join('+')}+${key}`
      : key;

    // Register hotkey
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkeys(
      hotkeyString,
      (event) => {
        event.preventDefault();
        callback();
      },
      HOTKEY_OPTIONS,
      [callback]
    );
  });
}
