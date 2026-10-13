import { describe, expect, it } from 'vite-plus/test'
import { shouldPreferDomPlayerForGizmo } from './gizmo-preview-presentation'

describe('shouldPreferDomPlayerForGizmo', () => {
  it.each(['text', 'shape'] as const)(
    'uses the live DOM player for %s gizmo previews',
    (itemType) => {
      expect(shouldPreferDomPlayerForGizmo(false, itemType)).toBe(true)
    },
  )

  it.each(['text', 'shape'] as const)(
    'keeps an effected underlay rendered while a %s transform is previewed',
    (itemType) => {
      expect(shouldPreferDomPlayerForGizmo(true, itemType)).toBe(false)
    },
  )

  it('does not change presentation for media gizmos', () => {
    expect(shouldPreferDomPlayerForGizmo(false, 'video')).toBe(false)
  })
})
