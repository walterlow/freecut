import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { MotionPathOverlay } from './motion-path-overlay'

describe('MotionPathOverlay', () => {
  it('renders paths and keyframe dots for supplied motion points', () => {
    render(
      <MotionPathOverlay
        width={640}
        height={360}
        paths={[
          {
            itemId: 'clip-1',
            points: [
              { frame: 0, x: 0, y: 0, screenX: 10, screenY: 20, isKeyframe: true },
              { frame: 15, x: 100, y: 50, screenX: 110, screenY: 70, isKeyframe: false },
              { frame: 30, x: 200, y: 100, screenX: 210, screenY: 120, isKeyframe: true },
            ],
          },
        ]}
      />,
    )

    const overlay = screen.getByTestId('motion-path-overlay')
    expect(overlay).toHaveAttribute('viewBox', '0 0 640 360')
    expect(overlay.querySelectorAll('path')).toHaveLength(2)
    expect(overlay.querySelectorAll('circle')).toHaveLength(2)
  })

  it('renders nothing when there are no paths', () => {
    const { container } = render(<MotionPathOverlay width={640} height={360} paths={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
