import { describe, expect, it } from 'vite-plus/test'
import { DOC_PAGES } from './docs-content'

describe('user guide content', () => {
  it('uses unique slugs and valid related-page links', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    const slugSet = new Set(slugs)

    expect(slugSet.size).toBe(slugs.length)

    for (const page of DOC_PAGES) {
      for (const relatedSlug of page.related ?? []) {
        expect(slugSet.has(relatedSlug), `${page.slug} links to missing page ${relatedSlug}`).toBe(
          true,
        )
      }
    }
  })

  it('uses the current Motion guide slugs', () => {
    const slugs = new Set(DOC_PAGES.map((page) => page.slug))

    expect(slugs.has('animate')).toBe(false)
    expect(slugs.has('motion')).toBe(true)
    expect(slugs.has('motion-library')).toBe(true)
  })
})
