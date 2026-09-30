// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { SFX_CATEGORIES, SFX_ITEMS, SFX_ASSETS_DIR } from './sfx-catalog'

describe('SFX Catalog', () => {
  it('defines all required categories', () => {
    const categoryIds = SFX_CATEGORIES.map((c) => c.id)
    expect(categoryIds).toContain('all')
    expect(categoryIds).toContain('transitions')
    expect(categoryIds).toContain('ui')
    expect(categoryIds).toContain('foley')
  })

  it('defines the correct assets directory path', () => {
    expect(SFX_ASSETS_DIR).toBe('public/assets/audio/sfx/')
  })

  it('provides an array of SFX items that satisfy metadata structure when populated', () => {
    expect(Array.isArray(SFX_ITEMS)).toBe(true)

    for (const item of SFX_ITEMS) {
      expect(item.id).toBeTruthy()
      expect(item.name).toBeTruthy()
      expect(item.duration).toBeGreaterThan(0)
      expect(item.description).toBeTruthy()
      expect(item.assetPath).toMatch(/^\/assets\/audio\/sfx\/.+$/)
      expect(['transitions', 'ui', 'foley']).toContain(item.category)
    }
  })
})
