import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { EDITOR_LAYOUT } from '@/app/editor-layout'
import { ToolOperationOverlay } from './tool-operation-overlay'

describe('ToolOperationOverlay', () => {
  it.each(['trim', 'ripple'] as const)('renders a full clip-height box for %s mode', (mode) => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode,
        }}
      />,
    )

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: '1px',
      bottom: '1px',
    })
  })

  it('renders a compact top box for slide mode', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode: 'slide',
        }}
      />,
    )

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: '0px',
      height: `${EDITOR_LAYOUT.timelineClipLabelRowHeight * 2}px`,
    })
  })

  it('renders a full-height box for slip mode', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode: 'slip',
        }}
      />,
    )

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: `${EDITOR_LAYOUT.timelineClipLabelRowHeight}px`,
      bottom: '1px',
    })
  })
})
