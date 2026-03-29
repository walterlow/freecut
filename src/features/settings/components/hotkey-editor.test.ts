import { describe, expect, it } from 'vitest';
import { HOTKEYS, HOTKEY_DESCRIPTIONS, type HotkeyKey } from '@/config/hotkeys';
import { HOTKEY_EDITOR_SECTIONS } from './hotkey-editor-sections';

describe('hotkey editor parity', () => {
  it('keeps dialog entries in sync with configured hotkeys and descriptions', () => {
    const configuredKeys = Object.keys(HOTKEYS) as HotkeyKey[];
    const describedKeys = Object.keys(HOTKEY_DESCRIPTIONS) as HotkeyKey[];
    const dialogKeys = HOTKEY_EDITOR_SECTIONS.flatMap((section) =>
      section.items.flatMap((item) => [...item.keys])
    );

    expect(new Set(describedKeys)).toEqual(new Set(configuredKeys));
    expect(new Set(dialogKeys)).toEqual(new Set(configuredKeys));
    expect(dialogKeys).toHaveLength(configuredKeys.length);
  });
});
