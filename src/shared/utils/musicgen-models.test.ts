import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUSICGEN_MODEL,
  MUSICGEN_MODEL_OPTIONS,
  getMusicgenMaxNewTokens,
  getMusicgenModelDefinition,
} from './musicgen-models';

describe('musicgen-models', () => {
  it('describes the default browser MusicGen model', () => {
    const definition = getMusicgenModelDefinition(DEFAULT_MUSICGEN_MODEL);

    expect(definition.modelId).toBe('Xenova/musicgen-small');
    expect(MUSICGEN_MODEL_OPTIONS[0]).toMatchObject({
      value: 'musicgen-small',
      label: 'MusicGen Small',
      downloadLabel: '~742 MB',
    });
  });

  it('converts seconds to MusicGen generation tokens', () => {
    expect(getMusicgenMaxNewTokens('musicgen-small', 8)).toBe(400);
    expect(getMusicgenMaxNewTokens('musicgen-small', 0)).toBe(1);
  });
});
