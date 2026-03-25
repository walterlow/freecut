import { describe, expect, it } from 'vitest';
import {
  HOTKEY_EXPORT_SCHEMA,
  HOTKEY_EXPORT_VERSION,
  createHotkeyExportDocument,
  findHotkeyConflicts,
  formatHotkeyBinding,
  getBrowserHostileHotkey,
  getHotkeyBindingFromEventData,
  getHotkeyPrimaryTokenFromEventData,
  normalizeHotkeyBinding,
  parseHotkeyImportDocument,
  resolveHotkeys,
  sanitizeHotkeyOverrides,
} from './hotkeys';

describe('normalizeHotkeyBinding', () => {
  it('orders modifiers consistently and normalizes aliases', () => {
    expect(normalizeHotkeyBinding('Shift+Ctrl+ArrowLeft')).toBe('mod+shift+left');
  });
});

describe('formatHotkeyBinding', () => {
  it('formats modifier labels for mac', () => {
    expect(formatHotkeyBinding('mod+alt+k', 'MacIntel')).toBe('Cmd + Option + K');
  });

  it('formats punctuation bindings for windows', () => {
    expect(formatHotkeyBinding('mod+shift+comma', 'Win32')).toBe('Ctrl + Shift + ,');
  });
});

describe('getBrowserHostileHotkey', () => {
  it('detects browser-reserved shortcuts after normalization', () => {
    expect(getBrowserHostileHotkey('Ctrl+E')).toEqual({
      binding: 'mod+e',
      browserAction: 'Focus search or address bar in some browsers',
    });
  });

  it('returns null for browser-safe shortcuts', () => {
    expect(getBrowserHostileHotkey('shift+j')).toBeNull();
  });

  it('flags browser zoom shortcuts as hostile', () => {
    expect(getBrowserHostileHotkey('Ctrl+=')).toEqual({
      binding: 'mod+equal',
      browserAction: 'Browser zoom in',
    });
    expect(getBrowserHostileHotkey('Ctrl+-')).toEqual({
      binding: 'mod+minus',
      browserAction: 'Browser zoom out',
    });
    expect(getBrowserHostileHotkey('Ctrl+0')).toEqual({
      binding: 'mod+0',
      browserAction: 'Reset browser zoom',
    });
  });

  it('flags Ctrl+Shift+L as hostile and leaves Shift+L available', () => {
    expect(getBrowserHostileHotkey('Ctrl+Shift+L')).toEqual({
      binding: 'mod+shift+l',
      browserAction: 'Focus address bar or search in some browsers',
    });
    expect(getBrowserHostileHotkey('Shift+L')).toBeNull();
  });
});

describe('getHotkeyBindingFromEventData', () => {
  it('captures letter bindings with modifiers', () => {
    expect(
      getHotkeyBindingFromEventData({
        code: 'KeyA',
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe('mod+shift+a');
  });

  it('captures modifier-only previews before a final key lands', () => {
    expect(
      getHotkeyBindingFromEventData({
        code: 'ShiftLeft',
        key: 'Shift',
        shiftKey: true,
      })
    ).toBe('shift');
  });

  it('uses event.code for shifted punctuation keys', () => {
    expect(
      getHotkeyPrimaryTokenFromEventData({
        code: 'Comma',
        key: '<',
        shiftKey: true,
      })
    ).toBe('comma');
  });
});

describe('findHotkeyConflicts', () => {
  it('returns other bindings using the same normalized shortcut', () => {
    const bindings = resolveHotkeys({
      SELECTION_TOOL: 'c',
    });

    expect(findHotkeyConflicts(bindings, 'c', 'SELECTION_TOOL')).toEqual(['RAZOR_TOOL']);
  });
});

describe('sanitizeHotkeyOverrides', () => {
  it('keeps only supported commands with normalized non-default bindings', () => {
    expect(
      sanitizeHotkeyOverrides({
        PLAY_PAUSE: ' Shift+Space ',
        EXPORT: 'Ctrl+E',
        UNKNOWN_COMMAND: 'q',
        DELETE_SELECTED: '',
      })
    ).toEqual({
      PLAY_PAUSE: 'shift+space',
      EXPORT: 'mod+e',
    });
  });
});

describe('createHotkeyExportDocument', () => {
  it('creates a versioned export with command metadata and sanitized overrides', () => {
    const exportDocument = createHotkeyExportDocument({
      PLAY_PAUSE: 'Shift+Space',
      EXPORT: 'Ctrl+E',
    });

    expect(exportDocument.schema).toBe(HOTKEY_EXPORT_SCHEMA);
    expect(exportDocument.version).toBe(HOTKEY_EXPORT_VERSION);
    expect(exportDocument.overrides).toEqual({
      PLAY_PAUSE: 'shift+space',
      EXPORT: 'mod+e',
    });
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'PLAY_PAUSE',
        label: 'Play/Pause',
        binding: 'shift+space',
        defaultBinding: 'space',
        isCustom: true,
      })
    );
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'EXPORT',
        binding: 'mod+e',
        defaultBinding: 'mod+shift+e',
        isCustom: true,
      })
    );
  });
});

describe('parseHotkeyImportDocument', () => {
  it('imports versioned override payloads and ignores unknown commands', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        overrides: {
          PLAY_PAUSE: 'Shift+Space',
          UNKNOWN_COMMAND: 'q',
        },
      })
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
      },
      importedCommandCount: 1,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: 1,
    });
  });

  it('falls back to command entries when overrides are missing', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [
          { id: 'PLAY_PAUSE', binding: 'Shift+Space' },
          { id: 'EXPORT', binding: 'Ctrl+E' },
          { id: 'UNKNOWN_COMMAND', binding: 'q' },
        ],
      })
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
        EXPORT: 'mod+e',
      },
      importedCommandCount: 2,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: 1,
    });
  });

  it('remaps renamed commands from exported metadata when ids no longer match', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [
          {
            id: 'PLAYBACK_TOGGLE_OLD',
            label: 'Play/Pause',
            defaultBinding: 'space',
            binding: 'Shift+Space',
          },
        ],
      })
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
      },
      importedCommandCount: 1,
      ignoredCommandCount: 0,
      remappedCommandCount: 1,
      sourceVersion: 1,
    });
  });

  it('supports plain legacy key-binding maps', () => {
    expect(
      parseHotkeyImportDocument({
        PLAY_PAUSE: 'Shift+Space',
        EXPORT: 'Ctrl+E',
        UNKNOWN_COMMAND: 'q',
      })
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
        EXPORT: 'mod+e',
      },
      importedCommandCount: 2,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: null,
    });
  });
});
