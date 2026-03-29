import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WHISPER_LANGUAGE,
  getWhisperQuantizationOption,
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  normalizeWhisperLanguage,
  WHISPER_AUTO_LANGUAGE_VALUE,
  WHISPER_LANGUAGE_OPTIONS,
} from './whisper-settings';

describe('whisper-settings', () => {
  it('uses auto-detect for blank language settings', () => {
    expect(getWhisperLanguageSelectValue(DEFAULT_WHISPER_LANGUAGE)).toBe(WHISPER_AUTO_LANGUAGE_VALUE);
    expect(getWhisperLanguageSettingValue(WHISPER_AUTO_LANGUAGE_VALUE)).toBe(DEFAULT_WHISPER_LANGUAGE);
  });

  it('keeps supported language codes stable in the select', () => {
    expect(getWhisperLanguageSelectValue('en')).toBe('en');
    expect(getWhisperLanguageSettingValue('es')).toBe('es');
  });

  it('normalizes language codes to lowercase', () => {
    expect(normalizeWhisperLanguage(' EN ')).toBe('en');
  });

  it('falls back to auto-detect when a stored language is unsupported', () => {
    expect(getWhisperLanguageSelectValue('english')).toBe(WHISPER_AUTO_LANGUAGE_VALUE);
  });

  it('includes common language options', () => {
    expect(WHISPER_LANGUAGE_OPTIONS[0]).toEqual({
      value: WHISPER_AUTO_LANGUAGE_VALUE,
      label: 'Auto-detect',
    });
    expect(WHISPER_LANGUAGE_OPTIONS).toContainEqual({ value: 'en', label: 'English' });
    expect(WHISPER_LANGUAGE_OPTIONS).toContainEqual({ value: 'es', label: 'Spanish' });
  });

  it('includes quantization guidance for memory tradeoffs', () => {
    expect(getWhisperQuantizationOption('hybrid')).toMatchObject({
      value: 'hybrid',
      label: 'Hybrid (Recommended)',
    });
    expect(getWhisperQuantizationOption('q4').description).toContain('low-memory');
    expect(getWhisperQuantizationOption(undefined).value).toBe('hybrid');
  });
});
