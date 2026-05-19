/**
 * Supported UI languages.
 *
 * `code` matches the i18next resource key and the persisted setting value.
 * `nativeName` is shown in the language selector (in the language's own script).
 * `englishName` is used for accessibility/searching.
 */
export interface AppLanguage {
  code: string
  nativeName: string
  englishName: string
  /** Text direction — all currently supported languages are LTR. */
  dir: 'ltr' | 'rtl'
}

export const SUPPORTED_LANGUAGES: readonly AppLanguage[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr' },
  {
    code: 'pt-BR',
    nativeName: 'Português',
    englishName: 'Portuguese',
    dir: 'ltr',
  },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', dir: 'ltr' },
  { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', dir: 'ltr' },
] as const

export const DEFAULT_LANGUAGE = 'en'

export const SUPPORTED_LANGUAGE_CODES: readonly string[] = SUPPORTED_LANGUAGES.map((l) => l.code)

export function isSupportedLanguage(code: string | null | undefined): boolean {
  return !!code && SUPPORTED_LANGUAGE_CODES.includes(code)
}

/**
 * Normalize an arbitrary locale string (e.g. `pt`, `pt-PT`, `zh-CN`, `en-US`)
 * to one of our supported codes, falling back to {@link DEFAULT_LANGUAGE}.
 */
export function resolveSupportedLanguage(code: string | null | undefined): string {
  if (!code) return DEFAULT_LANGUAGE
  if (isSupportedLanguage(code)) return code
  const base = code.split('-')[0]?.toLowerCase()
  if (!base) return DEFAULT_LANGUAGE
  if (base === 'pt') return 'pt-BR'
  if (base === 'zh') return 'zh'
  const match = SUPPORTED_LANGUAGE_CODES.find((c) => c.toLowerCase().split('-')[0] === base)
  return match ?? DEFAULT_LANGUAGE
}
