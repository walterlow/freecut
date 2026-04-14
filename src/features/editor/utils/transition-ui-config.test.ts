import { describe, expect, it } from 'vitest';
import {
  TRANSITION_CATEGORY_ORDER,
  TRANSITION_CATEGORY_START_INDICES,
  TRANSITION_CONFIGS_BY_CATEGORY,
  TRANSITION_PRESENTATION_CONFIGS,
} from './transition-ui-config';

function toConfigKey(config: { id: string; direction?: string }): string {
  return `${config.id}:${config.direction ?? ''}`;
}

describe('transition-ui-config', () => {
  it('keeps flat config offsets aligned with grouped category ordering', () => {
    for (const category of TRANSITION_CATEGORY_ORDER) {
      const groupedConfigs = TRANSITION_CONFIGS_BY_CATEGORY[category] ?? [];
      const startIndex = TRANSITION_CATEGORY_START_INDICES[category] ?? 0;
      const flatSlice = TRANSITION_PRESENTATION_CONFIGS.slice(
        startIndex,
        startIndex + groupedConfigs.length,
      );

      expect(flatSlice.map(toConfigKey)).toEqual(groupedConfigs.map(toConfigKey));
    }
  });

  it('resolves the glitch card to the glitch transition config', () => {
    const customConfigs = TRANSITION_CONFIGS_BY_CATEGORY.custom ?? [];
    const glitchIndex = customConfigs.findIndex((config) => config.id === 'glitch');

    expect(glitchIndex).toBeGreaterThanOrEqual(0);

    const startIndex = TRANSITION_CATEGORY_START_INDICES.custom ?? 0;
    const flatConfig = TRANSITION_PRESENTATION_CONFIGS[startIndex + glitchIndex];
    const groupedConfig = customConfigs[glitchIndex];

    expect(flatConfig).toBeDefined();
    expect(groupedConfig).toBeDefined();
    expect(toConfigKey(flatConfig!)).toBe(toConfigKey(groupedConfig!));
  });

  it('shows chromatic in its own category instead of custom', () => {
    const chromaticConfigs = TRANSITION_CONFIGS_BY_CATEGORY.chromatic ?? [];
    const customConfigs = TRANSITION_CONFIGS_BY_CATEGORY.custom ?? [];

    expect(chromaticConfigs.some((config) => config.id === 'chromatic')).toBe(true);
    expect(customConfigs.some((config) => config.id === 'chromatic')).toBe(false);
  });

  it('shows sparkles in the custom category', () => {
    const customConfigs = TRANSITION_CONFIGS_BY_CATEGORY.custom ?? [];

    expect(customConfigs.some((config) => config.id === 'sparkles')).toBe(true);
    expect((TRANSITION_CONFIGS_BY_CATEGORY.light ?? []).some((config) => config.id === 'sparkles')).toBe(false);
  });
});
