import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { BackgroundTaskProgress } from './background-task-progress'

describe('BackgroundTaskProgress', () => {
  it('renders determinate progress with custom meta actions', () => {
    const onCancel = vi.fn()

    render(
      <BackgroundTaskProgress
        icon={<span>icon</span>}
        label="Generating transcripts"
        progressAriaLabel="Transcript generation progress"
        progressPercent={42.4}
        meta={
          <>
            <span>42%</span>
            <button type="button" onClick={onCancel}>
              Cancel all
            </button>
          </>
        }
        fillClassName="bg-blue-500"
      />,
    )

    expect(screen.getByText('Generating transcripts')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Transcript generation progress' }),
    ).toHaveAttribute('aria-valuenow', '42')

    fireEvent.click(screen.getByText('Cancel all'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders indeterminate progress without a numeric value', () => {
    render(
      <BackgroundTaskProgress
        icon={<span>icon</span>}
        label="Analyzing with AI"
        progressAriaLabel="AI analysis progress"
        indeterminate
        meta={<span>Working...</span>}
        fillClassName="bg-purple-500"
      />,
    )

    expect(screen.getByRole('progressbar', { name: 'AI analysis progress' })).not.toHaveAttribute(
      'aria-valuenow',
    )
    expect(screen.getByText('Working...')).toBeInTheDocument()
  })
})
