import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'

describe('DopesheetEditor playhead overlay', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('clamps the playhead to the left edge when the current frame is before the viewport', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
      />,
    )

    const clip = screen.getByTestId('dopesheet-playhead-clip')
    const line = screen.getByTestId('dopesheet-playhead-line')

    expect(clip).toHaveStyle({ left: '248px' })
    expect(clip).toHaveClass('overflow-hidden')
    // Playhead should be clamped to 0 (left edge), not negative
    expect(line).toHaveStyle({ left: '0px' })
  })

  it('shows the shared ruler in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
        visualizationMode="graph"
      />,
    )

    expect(screen.getByTestId('dopesheet-ruler')).toHaveClass('cursor-ew-resize')
    expect(screen.getByTestId('dopesheet-playhead-line')).toBeInTheDocument()
  })

  it('keeps the navigator in the right viewport column', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('keyframe-navigator-property-column')).toBeInTheDocument()
    expect(screen.getByTestId('keyframe-navigator-viewport-column')).toContainElement(
      screen.getByTestId('keyframe-navigator-thumb'),
    )
  })
})
