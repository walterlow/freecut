import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuPowerWindowPanel } from './gpu-power-window-panel'

const definition = getGpuEffect('gpu-power-window')!

function makeProps(params: Record<string, number | boolean | string> = {}) {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-power-window',
    params,
  }
  const effect: ItemEffect = { id: 'fx-window', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuPowerWindowPanel', () => {
  it('renders the power window as window, matte, and correction sections', () => {
    render(<GpuPowerWindowPanel {...makeProps()} />)

    expect(screen.getByText('Power Window')).toBeInTheDocument()
    expect(screen.getByText('Window')).toBeInTheDocument()
    expect(screen.getByText('Matte')).toBeInTheDocument()
    expect(screen.getByText('Correction')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ellipse' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('switches the active window shape', () => {
    const props = makeProps({ shape: 'ellipse' })
    render(<GpuPowerWindowPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }))

    expect(props.onParamChange).toHaveBeenCalledWith('fx-window', 'shape', 'rectangle')
  })

  it('toggles matte preview and inverted matte params', () => {
    const props = makeProps({ showMask: false, invertMask: false })
    render(<GpuPowerWindowPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show Mask' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invert Mask' }))

    expect(props.onParamChange).toHaveBeenCalledWith('fx-window', 'showMask', true)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-window', 'invertMask', true)
  })
})
