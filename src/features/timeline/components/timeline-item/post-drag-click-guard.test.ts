import { describe, expect, it } from 'vite-plus/test'
import { shouldSuppressTimelineItemClickAfterDrag } from './post-drag-click-guard'

describe('shouldSuppressTimelineItemClickAfterDrag', () => {
  it('suppresses post-drag clicks for selection tools', () => {
    expect(shouldSuppressTimelineItemClickAfterDrag('select', true)).toBe(true)
    expect(shouldSuppressTimelineItemClickAfterDrag('trim-edit', true)).toBe(true)
  })

  it('allows post-drag clicks for non-selection tools so razor and edit tools still work', () => {
    expect(shouldSuppressTimelineItemClickAfterDrag('razor', true)).toBe(false)
    expect(shouldSuppressTimelineItemClickAfterDrag('rate-stretch', true)).toBe(false)
    expect(shouldSuppressTimelineItemClickAfterDrag('slip', true)).toBe(false)
    expect(shouldSuppressTimelineItemClickAfterDrag('slide', true)).toBe(false)
  })

  it('never suppresses when no drag just finished', () => {
    expect(shouldSuppressTimelineItemClickAfterDrag('select', false)).toBe(false)
    expect(shouldSuppressTimelineItemClickAfterDrag('razor', false)).toBe(false)
  })
})
