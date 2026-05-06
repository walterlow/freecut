import { describe, expect, it } from 'vite-plus/test'
import { EDITOR_LAYOUT } from '@/app/editor-layout'
import { getTimelineClipLabelRowHeightPx } from './hover-layout'

describe('hover layout', () => {
  it('reads the clip label row height from the computed CSS variable', () => {
    const element = document.createElement('div')
    element.style.setProperty('--editor-timeline-clip-label-row-height', '22px')
    document.body.appendChild(element)

    expect(getTimelineClipLabelRowHeightPx(element)).toBe(22)

    element.remove()
  })

  it('falls back to the default layout when the CSS variable is unavailable', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    expect(getTimelineClipLabelRowHeightPx(element)).toBe(EDITOR_LAYOUT.timelineClipLabelRowHeight)

    element.remove()
  })
})
