// @vitest-environment node

/**
 * Tests for the lazy locale loading strategy introduced in plan 005.
 *
 * English partials are bundled eagerly; all other languages load on demand
 * via loadLanguageResources / changeAppLanguage.
 */
import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { i18n, changeAppLanguage, loadLanguageResources } from './index'

// A key that lives only in partials (not in the base locale files), so it
// exercises the partial-merge path for every language tested.
const PARTIAL_ONLY_KEY = 'editor.tts.kokoroOption'
const EN_VALUE = 'Kokoro (English, WebGPU)'
const DE_VALUE = 'Kokoro (Englisch, WebGPU)'

describe('lazy locale loading', () => {
  beforeEach(async () => {
    // Reset to English so each test starts from a known state.
    await i18n.changeLanguage('en')
  })

  it('test 1: English is available synchronously after module import', () => {
    // en partials are eagerly bundled — no await needed.
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(EN_VALUE)
  })

  it('test 2: lazy language loads fully', async () => {
    await changeAppLanguage('de')
    expect(i18n.language).toBe('de')
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(DE_VALUE)
  })

  it('test 3: fallback to English before a language is loaded', () => {
    // fr partials have NOT been loaded yet (we reset to en in beforeEach).
    // A partial-only key should fall back to the English value, not the key itself.
    const tFr = i18n.getFixedT('fr')
    expect(tFr(PARTIAL_ONLY_KEY)).toBe(EN_VALUE)
  })

  it('test 4: changeAppLanguage is idempotent', async () => {
    await changeAppLanguage('de')
    await changeAppLanguage('de') // second call — should be a no-op
    expect(i18n.language).toBe('de')
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(DE_VALUE)
  })

  it('test 5: structural parity — every language dir has the same partial files as en', async () => {
    const allModules = import.meta.glob('./locales/partials/*/*.json')
    const paths = Object.keys(allModules)

    function filesForLang(lang: string): Set<string> {
      const prefix = `./locales/partials/${lang}/`
      return new Set(paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)))
    }

    const enFiles = filesForLang('en')
    expect(enFiles.size).toBeGreaterThan(0)

    const langs = ['es', 'fr', 'de', 'pt-BR', 'tr', 'ja', 'ko', 'zh']
    for (const lang of langs) {
      const langFiles = filesForLang(lang)
      expect(langFiles, `${lang} should have the same partial files as en`).toEqual(enFiles)
    }
  })

  it('loadLanguageResources resolves for en without doing extra work', async () => {
    // en is already loaded — calling loadLanguageResources('en') is a no-op
    // and should resolve immediately without error.
    await expect(loadLanguageResources('en')).resolves.toBeUndefined()
    // English still works
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(EN_VALUE)
  })
})
