import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { TextMotionSlotRows } from './text-motion-slot-rows'

const TEXT_ITEM = {
  id: 'text-1',
  type: 'text',
  trackId: 'v1',
  from: 0,
  durationInFrames: 90,
  label: 'Title',
  text: 'Hello',
} as TextItem

describe('TextMotionSlotRows preset search', () => {
  it('shows only text-motion presets matching the query', () => {
    render(<TextMotionSlotRows items={[TEXT_ITEM]} query="typewriter" />)

    expect(screen.getByRole('button', { name: 'Typewriter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fade Up' })).not.toBeInTheDocument()
  })

  it('renders a useful empty state when no text-motion preset matches', () => {
    render(<TextMotionSlotRows items={[TEXT_ITEM]} query="no-such-animation" />)

    expect(screen.getByRole('status')).toHaveTextContent('No matching animations.')
  })

  it('can render one intent slot without a repeated slot heading', () => {
    render(<TextMotionSlotRows items={[TEXT_ITEM]} slots={['loop']} showSlotHeading={false} />)

    expect(screen.getByRole('button', { name: 'Pulse' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Typewriter' })).not.toBeInTheDocument()
    expect(screen.queryByText('Loop')).not.toBeInTheDocument()
  })
})
