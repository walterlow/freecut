import { describe, expect, it } from 'vitest';
import { resolveKeyframeEditorHotkeyProperty } from './keyframe-editor-hotkey';

describe('resolveKeyframeEditorHotkeyProperty', () => {
  it('uses the last active dopesheet row when all properties are visible', () => {
    expect(
      resolveKeyframeEditorHotkeyProperty('dopesheet', null, ['x', 'y', 'opacity'], 'y')
    ).toBe('y');
  });

  it('returns null in dopesheet mode when all properties are visible and no row is active', () => {
    expect(
      resolveKeyframeEditorHotkeyProperty('dopesheet', null, ['x', 'y', 'opacity'], null)
    ).toBeNull();
  });

  it('falls back to the displayed graph property when graph selection is unset', () => {
    expect(
      resolveKeyframeEditorHotkeyProperty('split', null, ['opacity', 'x'], 'x')
    ).toBe('opacity');
  });
});
