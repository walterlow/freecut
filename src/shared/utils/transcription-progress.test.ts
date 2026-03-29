import { describe, expect, it } from 'vitest';
import {
  getTranscriptionOverallPercent,
  getTranscriptionStageLabel,
  mergeTranscriptionProgress,
} from './transcription-progress';

describe('transcription-progress', () => {
  it('maps stages into a stable overall percentage range', () => {
    expect(getTranscriptionOverallPercent({ stage: 'loading', progress: 1 })).toBe(35);
    expect(getTranscriptionOverallPercent({ stage: 'decoding', progress: 0.5 })).toBeCloseTo(52.5);
    expect(getTranscriptionOverallPercent({ stage: 'transcribing', progress: 0.5 })).toBe(85);
  });

  it('keeps progress monotonic when earlier stages report after later stages', () => {
    const decodingProgress = mergeTranscriptionProgress(undefined, {
      stage: 'decoding',
      progress: 0.5,
    });

    expect(
      mergeTranscriptionProgress(decodingProgress, {
        stage: 'loading',
        progress: 1,
      })
    ).toEqual(decodingProgress);
  });

  it('clamps progress values to the supported range', () => {
    expect(getTranscriptionOverallPercent({ stage: 'loading', progress: 5 })).toBe(35);
    expect(
      mergeTranscriptionProgress(undefined, {
        stage: 'transcribing',
        progress: -1,
      })
    ).toEqual({
      stage: 'transcribing',
      progress: 0,
    });
  });

  it('formats readable stage labels', () => {
    expect(getTranscriptionStageLabel('loading')).toBe('Loading model');
    expect(getTranscriptionStageLabel('decoding')).toBe('Decoding audio');
    expect(getTranscriptionStageLabel('transcribing')).toBe('Transcribing');
  });
});
