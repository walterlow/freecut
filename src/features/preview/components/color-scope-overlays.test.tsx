import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { ScopeCanvasFrame } from './color-scope-overlays'
import { SCOPE_LUMA_GUIDES, VECTOR_SCOPE_TARGETS } from './color-scope-overlay-data'

describe('color scope overlays', () => {
  it('renders luma graticule labels over a waveform canvas', () => {
    const ref = createRef<HTMLDivElement>()
    const rendered = render(
      <ScopeCanvasFrame containerRef={ref} kind="waveform">
        <canvas aria-label="waveform canvas" />
      </ScopeCanvasFrame>,
    )

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(screen.getByLabelText('waveform canvas')).toBeTruthy()
    for (const guide of SCOPE_LUMA_GUIDES) {
      expect(rendered.container).toHaveTextContent(String(guide))
    }
  })

  it('renders vectorscope targets and skin-tone reference line label', () => {
    const ref = createRef<HTMLDivElement>()
    const rendered = render(
      <ScopeCanvasFrame containerRef={ref} kind="vectorscope">
        <canvas aria-label="vectorscope canvas" />
      </ScopeCanvasFrame>,
    )

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(screen.getByLabelText('vectorscope canvas')).toBeTruthy()
    expect(rendered.container).toHaveTextContent('skin')
    for (const target of VECTOR_SCOPE_TARGETS) {
      expect(rendered.container).toHaveTextContent(target.label)
    }
  })
})
