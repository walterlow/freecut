import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { ClipIndicators } from './clip-indicators'

describe('ClipIndicators', () => {
  it('shows a speed badge when playback speed differs from 1x', () => {
    render(
      <ClipIndicators
        hasKeyframes={false}
        currentSpeed={1.25}
        isReversed={false}
        isStretching={false}
        stretchFeedback={null}
        isBroken={false}
        hasMediaId
        isMask={false}
        isShape={false}
      />,
    )

    expect(screen.getByTitle('Speed: 1.25x')).toBeInTheDocument()
  })
})
