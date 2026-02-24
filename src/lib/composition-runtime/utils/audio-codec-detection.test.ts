import { describe, expect, it } from 'vitest';
import { needsCustomAudioDecoder } from './audio-codec-detection';

describe('needsCustomAudioDecoder', () => {
  it('detects AC-3/E-AC-3 codecs', () => {
    expect(needsCustomAudioDecoder('ac-3')).toBe(true);
    expect(needsCustomAudioDecoder('ec-3')).toBe(true);
    expect(needsCustomAudioDecoder('Dolby Digital Plus')).toBe(true);
  });

  it('detects PCM endian codec ids', () => {
    expect(needsCustomAudioDecoder('pcm-s16be')).toBe(true);
    expect(needsCustomAudioDecoder('pcm-s24le')).toBe(true);
    expect(needsCustomAudioDecoder('pcm-f64be')).toBe(true);
    expect(needsCustomAudioDecoder('PCM Little Endian')).toBe(true);
  });

  it('detects common quicktime/aiff pcm aliases', () => {
    expect(needsCustomAudioDecoder('twos')).toBe(true);
    expect(needsCustomAudioDecoder('sowt')).toBe(true);
    expect(needsCustomAudioDecoder('lpcm')).toBe(true);
  });

  it('returns false for standard browser-decodable codecs', () => {
    expect(needsCustomAudioDecoder(undefined)).toBe(false);
    expect(needsCustomAudioDecoder('aac')).toBe(false);
    expect(needsCustomAudioDecoder('opus')).toBe(false);
  });
});
