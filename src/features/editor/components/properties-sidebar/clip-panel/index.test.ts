import { describe, expect, it } from 'vitest';

import { resolveClipPanelTab } from './tab-selection';

describe('resolveClipPanelTab', () => {
  it('keeps the current tab when it is still available', () => {
    expect(
      resolveClipPanelTab('effects', {
        showTransformTab: true,
        showEffectsTab: true,
        showMediaTab: true,
      })
    ).toBe('effects');
  });

  it('falls back to the first available tab when the current tab is disabled', () => {
    expect(
      resolveClipPanelTab('transform', {
        showTransformTab: false,
        showEffectsTab: true,
        showMediaTab: true,
      })
    ).toBe('effects');
  });

  it('falls back to media when it is the only enabled tab', () => {
    expect(
      resolveClipPanelTab('effects', {
        showTransformTab: false,
        showEffectsTab: false,
        showMediaTab: true,
      })
    ).toBe('media');
  });
});
