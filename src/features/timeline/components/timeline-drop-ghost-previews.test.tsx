import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import {
  TimelineDropGhostPreviews,
  type TimelineDropGhostPreviewsHandle,
} from './timeline-drop-ghost-previews'

describe('TimelineDropGhostPreviews', () => {
  it('does not render a lane-wide overlay', () => {
    const { container } = render(<TimelineDropGhostPreviews variant="track" />)

    expect(container.querySelector('.border-primary\\/50')).toBeNull()
  })

  it('renders track ghost previews with track-specific classes', () => {
    const ref = createRef<TimelineDropGhostPreviewsHandle>()
    render(<TimelineDropGhostPreviews ref={ref} variant="track" />)

    act(() => {
      ref.current?.sync([{ left: 12, width: 48, label: 'Drop media', type: 'external-file' }])
    })

    const ghost = screen.getByText('Drop media').parentElement
    expect(ghost?.className).toContain('inset-y-0')
    expect(ghost?.className).toContain('border-orange-500')
    expect(ghost).toHaveStyle({ left: '12px', width: '48px' })
  })

  it('renders zone ghost previews with full-height styling', () => {
    const ref = createRef<TimelineDropGhostPreviewsHandle>()
    render(<TimelineDropGhostPreviews ref={ref} variant="zone" />)

    act(() => {
      ref.current?.sync([{ left: 20, width: 80, label: 'Clip', type: 'video' }])
    })

    const ghost = screen.getByText('Clip').parentElement
    expect(ghost?.className).not.toContain('inset-y-0')
    expect(ghost).toHaveStyle({ left: '20px', width: '80px', top: '0px', height: '100%' })
  })
})
