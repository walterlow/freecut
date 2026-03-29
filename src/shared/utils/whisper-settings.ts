import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';

export const DEFAULT_WHISPER_MODEL: MediaTranscriptModel = 'whisper-tiny';
export const DEFAULT_WHISPER_QUANTIZATION: MediaTranscriptQuantization = 'hybrid';
export const DEFAULT_WHISPER_LANGUAGE = '';
export const WHISPER_AUTO_LANGUAGE_VALUE = 'auto';

export const WHISPER_MODEL_LABELS: Record<MediaTranscriptModel, string> = {
  'whisper-tiny': 'Tiny',
  'whisper-base': 'Base',
  'whisper-small': 'Small',
  'whisper-large': 'Large v3 Turbo',
};

export const WHISPER_MODEL_OPTIONS: ReadonlyArray<{
  value: MediaTranscriptModel;
  label: string;
}> = [
  { value: 'whisper-tiny', label: WHISPER_MODEL_LABELS['whisper-tiny'] },
  { value: 'whisper-base', label: WHISPER_MODEL_LABELS['whisper-base'] },
  { value: 'whisper-small', label: WHISPER_MODEL_LABELS['whisper-small'] },
  { value: 'whisper-large', label: WHISPER_MODEL_LABELS['whisper-large'] },
];

export const WHISPER_QUANTIZATION_OPTIONS: ReadonlyArray<{
  value: MediaTranscriptQuantization;
  label: string;
  description: string;
}> = [
  {
    value: 'hybrid',
    label: 'Hybrid (Recommended)',
    description: 'Best default. Balanced memory use with the safest Whisper behavior.',
  },
  {
    value: 'fp32',
    label: 'FP32 (Highest Memory)',
    description: 'Use when memory is not a concern and you want the safest full-precision path.',
  },
  {
    value: 'fp16',
    label: 'FP16 (Lower Memory on WebGPU)',
    description: 'Use on capable WebGPU systems when you want lower memory than FP32.',
  },
  {
    value: 'q8',
    label: 'Q8 (Tight Memory)',
    description: 'Use only when memory is tighter. Often less reliable than Hybrid for Whisper.',
  },
  {
    value: 'q4',
    label: 'Q4 (Lowest Memory)',
    description: 'Last-resort low-memory mode. Expect rougher captions and slower tuning.',
  },
];

export function getWhisperQuantizationOption(
  value: MediaTranscriptQuantization | undefined,
) {
  return WHISPER_QUANTIZATION_OPTIONS.find((option) => option.value === value)
    ?? WHISPER_QUANTIZATION_OPTIONS[0];
}

const WHISPER_LANGUAGE_NAMES = {
  en: 'english',
  zh: 'chinese',
  de: 'german',
  es: 'spanish',
  ru: 'russian',
  ko: 'korean',
  fr: 'french',
  ja: 'japanese',
  pt: 'portuguese',
  tr: 'turkish',
  pl: 'polish',
  ca: 'catalan',
  nl: 'dutch',
  ar: 'arabic',
  sv: 'swedish',
  it: 'italian',
  id: 'indonesian',
  hi: 'hindi',
  fi: 'finnish',
  vi: 'vietnamese',
  he: 'hebrew',
  uk: 'ukrainian',
  el: 'greek',
  ms: 'malay',
  cs: 'czech',
  ro: 'romanian',
  da: 'danish',
  hu: 'hungarian',
  ta: 'tamil',
  no: 'norwegian',
  th: 'thai',
  ur: 'urdu',
  hr: 'croatian',
  bg: 'bulgarian',
  lt: 'lithuanian',
  la: 'latin',
  mi: 'maori',
  ml: 'malayalam',
  cy: 'welsh',
  sk: 'slovak',
  te: 'telugu',
  fa: 'persian',
  lv: 'latvian',
  bn: 'bengali',
  sr: 'serbian',
  az: 'azerbaijani',
  sl: 'slovenian',
  kn: 'kannada',
  et: 'estonian',
  mk: 'macedonian',
  br: 'breton',
  eu: 'basque',
  is: 'icelandic',
  hy: 'armenian',
  ne: 'nepali',
  mn: 'mongolian',
  bs: 'bosnian',
  kk: 'kazakh',
  sq: 'albanian',
  sw: 'swahili',
  gl: 'galician',
  mr: 'marathi',
  pa: 'punjabi',
  si: 'sinhala',
  km: 'khmer',
  sn: 'shona',
  yo: 'yoruba',
  so: 'somali',
  af: 'afrikaans',
  oc: 'occitan',
  ka: 'georgian',
  be: 'belarusian',
  tg: 'tajik',
  sd: 'sindhi',
  gu: 'gujarati',
  am: 'amharic',
  yi: 'yiddish',
  lo: 'lao',
  uz: 'uzbek',
  fo: 'faroese',
  ht: 'haitian creole',
  ps: 'pashto',
  tk: 'turkmen',
  nn: 'nynorsk',
  mt: 'maltese',
  sa: 'sanskrit',
  lb: 'luxembourgish',
  my: 'myanmar',
  bo: 'tibetan',
  tl: 'tagalog',
  mg: 'malagasy',
  as: 'assamese',
  tt: 'tatar',
  haw: 'hawaiian',
  ln: 'lingala',
  ha: 'hausa',
  ba: 'bashkir',
  jw: 'javanese',
  su: 'sundanese',
  yue: 'cantonese',
} as const;

const WHISPER_LANGUAGE_VALUES = new Set(Object.keys(WHISPER_LANGUAGE_NAMES));

function formatWhisperLanguageLabel(languageName: string): string {
  return languageName.replace(/\b\w/g, (char) => char.toUpperCase());
}

export const WHISPER_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: WHISPER_AUTO_LANGUAGE_VALUE, label: 'Auto-detect' },
  ...Object.entries(WHISPER_LANGUAGE_NAMES)
    .map(([value, label]) => ({
      value,
      label: formatWhisperLanguageLabel(label),
    }))
    .sort((left, right) => left.label.localeCompare(right.label)),
];

export function getWhisperLanguageSelectValue(language: string | undefined): string {
  const normalized = normalizeWhisperLanguage(language);
  if (!normalized) {
    return WHISPER_AUTO_LANGUAGE_VALUE;
  }

  return WHISPER_LANGUAGE_VALUES.has(normalized)
    ? normalized
    : WHISPER_AUTO_LANGUAGE_VALUE;
}

export function getWhisperLanguageSettingValue(value: string): string {
  return value === WHISPER_AUTO_LANGUAGE_VALUE ? DEFAULT_WHISPER_LANGUAGE : value;
}

export function normalizeWhisperLanguage(language: string | undefined): string | undefined {
  const trimmed = language?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}
