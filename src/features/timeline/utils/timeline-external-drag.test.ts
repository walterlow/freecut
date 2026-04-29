import { describe, expect, it } from 'vite-plus/test'
import {
  isDirectEffectTemplateDragData,
  shouldIgnoreNewTrackZonePreviewForDrag,
  shouldIgnoreTrackDropPreviewForDrag,
  shouldSuppressEmptyTrackDropOverlay,
} from './timeline-external-drag'

const effectTemplate = {
  type: 'timeline-template' as const,
  itemType: 'adjustment' as const,
  label: 'Motion Blur',
  effects: [{ type: 'gpu-effect' as const, gpuEffectType: 'motion-blur', params: {} }],
}

const blankAdjustmentTemplate = {
  type: 'timeline-template' as const,
  itemType: 'adjustment' as const,
  label: 'Blank Adjustment',
}

describe('timeline external drag policy', () => {
  it('recognizes effect templates that can be applied directly to clips', () => {
    expect(isDirectEffectTemplateDragData(effectTemplate)).toBe(true)
    expect(isDirectEffectTemplateDragData(blankAdjustmentTemplate)).toBe(false)
    expect(isDirectEffectTemplateDragData(null)).toBe(false)
  })

  it('keeps effect templates droppable on video lanes while rejecting audio lanes', () => {
    expect(shouldIgnoreTrackDropPreviewForDrag(effectTemplate, 'video')).toBe(false)
    expect(shouldIgnoreTrackDropPreviewForDrag(effectTemplate, 'audio')).toBe(true)
    expect(shouldIgnoreTrackDropPreviewForDrag(blankAdjustmentTemplate, 'audio')).toBe(false)
  })

  it('allows effect templates in video new-track zones only', () => {
    expect(shouldIgnoreNewTrackZonePreviewForDrag(effectTemplate, 'video')).toBe(false)
    expect(shouldIgnoreNewTrackZonePreviewForDrag(effectTemplate, 'audio')).toBe(true)
  })

  it('suppresses the empty brown lane overlay for effect-template drags only', () => {
    expect(shouldSuppressEmptyTrackDropOverlay(effectTemplate)).toBe(true)
    expect(shouldSuppressEmptyTrackDropOverlay(blankAdjustmentTemplate)).toBe(false)
  })
})
