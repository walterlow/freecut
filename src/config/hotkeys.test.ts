import { describe, expect, it } from 'vitest';
import {
  findHotkeyConflicts,
  formatHotkeyBinding,
  getHotkeyBindingFromEventData,
  getHotkeyPrimaryTokenFromEventData,
  normalizeHotkeyBinding,
  resolveHotkeys,
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

describe('getHotkeyBindingFromEventData', () => {
  it('captures letter bindings with modifiers', () => {
    expect(
      getHotkeyBindingFromEventData({
        code: 'KeyK',
        key: 'k',
        ctrlKey: true,
      })
    ).toBe('mod+k');
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
