import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingText,
  sliceTranscript,
} from './context';
import { parseSceneCaptionResponse } from '../captioning/scene-caption-format';

describe('sliceTranscript', () => {
  const segments = [
    { text: 'In the beginning.', start: 0, end: 2 },
    { text: 'We see a mountain.', start: 2, end: 5 },
    { text: 'The chef prepares dinner.', start: 10, end: 13 },
    { text: 'Later that night.', start: 30, end: 32 },
  ];

  it('pulls segments overlapping the caption window', () => {
    expect(sliceTranscript(segments, 11, 2)).toBe('The chef prepares dinner.');
  });

  it('joins adjacent overlapping segments with a space', () => {
    expect(sliceTranscript(segments, 3, 2)).toBe('In the beginning. We see a mountain.');
  });

  it('returns empty string when transcript is missing', () => {
    expect(sliceTranscript(null, 10)).toBe('');
    expect(sliceTranscript(undefined, 10)).toBe('');
    expect(sliceTranscript([], 10)).toBe('');
  });

  it('returns empty string when nothing overlaps', () => {
    expect(sliceTranscript(segments, 20, 1)).toBe('');
  });

  it('clips long transcripts to a word boundary', () => {
    const long = Array.from({ length: 50 }, (_, i) => ({
      text: `this is sentence number ${i}`,
      start: i,
      end: i + 1,
    }));
    const result = sliceTranscript(long, 25, 20);
    expect(result.length).toBeLessThanOrEqual(220);
    expect(result.endsWith(' ')).toBe(false);
    expect(result.split(' ').pop()).not.toMatch(/^[a-z]*\d{1,2}$/);
  });
});

describe('buildEmbeddingText', () => {
  const base = {
    caption: { text: 'A tree with orange leaves.', timeSec: 10 },
  };

  it('always starts with SCENE: <caption>', () => {
    const result = buildEmbeddingText(base);
    expect(result.startsWith('SCENE: A tree with orange leaves.')).toBe(true);
  });

  it('includes structured scene metadata when supplied', () => {
    const result = buildEmbeddingText({
      ...base,
      sceneData: {
        shotType: 'medium close-up',
        timeOfDay: 'dusk',
        weather: 'rainy',
      },
    });
    expect(result).toMatch(/SHOT: medium close-up/);
    expect(result).toMatch(/TIME: dusk/);
    expect(result).toMatch(/WEATHER: rainy/);
  });

  it('omits SPEECH: when transcript is missing or unmatched', () => {
    const result = buildEmbeddingText(base);
    expect(result).not.toMatch(/SPEECH:/);
  });

  it('includes SPEECH: when transcript overlaps caption timestamp', () => {
    const result = buildEmbeddingText({
      ...base,
      transcriptSegments: [{ text: 'and here is hokkaido', start: 9, end: 11 }],
    });
    expect(result).toMatch(/SPEECH: and here is hokkaido/);
  });

  it('does not emit SOURCE: because filename was dropped from context', () => {
    const result = buildEmbeddingText(base);
    expect(result).not.toMatch(/SOURCE:/);
  });

  it('includes COLORS: when a phrase is provided', () => {
    const result = buildEmbeddingText({ ...base, colorPhrase: 'warm orange, teal' });
    expect(result).toMatch(/COLORS: warm orange, teal/);
  });

  it('omits COLORS: for empty string', () => {
    const result = buildEmbeddingText({ ...base, colorPhrase: '   ' });
    expect(result).not.toMatch(/COLORS:/);
  });

  it('preserves scene metadata before transcript and colors', () => {
    const result = buildEmbeddingText({
      ...base,
      sceneData: {
        shotType: 'wide shot',
        timeOfDay: 'dusk',
        weather: 'foggy',
      },
      transcriptSegments: [{ text: 'speech here', start: 9, end: 11 }],
      colorPhrase: 'deep blue',
    });
    const sceneIdx = result.indexOf('SCENE:');
    const shotIdx = result.indexOf('SHOT:');
    const timeIdx = result.indexOf('TIME:');
    const weatherIdx = result.indexOf('WEATHER:');
    const speechIdx = result.indexOf('SPEECH:');
    const colorsIdx = result.indexOf('COLORS:');
    expect(sceneIdx).toBeLessThan(shotIdx);
    expect(shotIdx).toBeLessThan(timeIdx);
    expect(timeIdx).toBeLessThan(weatherIdx);
    expect(weatherIdx).toBeLessThan(speechIdx);
    expect(speechIdx).toBeLessThan(colorsIdx);
  });

  it('produces a valid string even with only a caption', () => {
    const result = buildEmbeddingText({
      caption: { text: 'Minimal scene.', timeSec: 0 },
    });
    expect(result).toBe('SCENE: Minimal scene.');
  });

  it('preserves richer scene captions verbatim for downstream semantic indexing', () => {
    const result = buildEmbeddingText({
      caption: { text: 'Medium close-up of a singer on a rainy street at dusk.', timeSec: 12 },
      sceneData: {
        shotType: 'medium close-up',
        timeOfDay: 'dusk',
        weather: 'rainy',
      },
    });
    expect(result).toBe(
      'SCENE: Medium close-up of a singer on a rainy street at dusk.\n'
      + 'SHOT: medium close-up\n'
      + 'TIME: dusk\n'
      + 'WEATHER: rainy',
    );
  });

  it('turns json-ish caption model output into clean embedding text', () => {
    const parsed = parseSceneCaptionResponse(
      'Json ["caption":"A dimly lit corridor illuminated by hanging lanterns, with a text overlay in Chinese at the bottom.","shotType":"medium wide shot","subjects":["lanterns","corridor","text"],"action":"glowing softly","setting":"interior corridor","lighting":"golden lantern light","timeOfDay":null,"weather":null}.',
    );

    expect(buildEmbeddingText({
      caption: { text: parsed.text, timeSec: 9 },
      sceneData: parsed.sceneData,
    })).toBe(
      'SCENE: A dimly lit corridor illuminated by hanging lanterns, with a text overlay in Chinese at the bottom.\n'
      + 'SHOT: medium-wide shot',
    );
  });
});
