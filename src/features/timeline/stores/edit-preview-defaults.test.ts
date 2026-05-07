import { describe, expect, it } from 'vite-plus/test'
import { withPreviewDefaults } from './edit-preview-defaults'

describe('withPreviewDefaults', () => {
  it('fills undefined and missing preview fields with defaults', () => {
    const preview = withPreviewDefaults(
      { itemId: 'clip-1', minDelta: -12, maxDelta: undefined },
      { minDelta: 0, maxDelta: 0, constrained: false },
    )

    expect(preview).toEqual({
      itemId: 'clip-1',
      minDelta: -12,
      maxDelta: 0,
      constrained: false,
    })
  })

  it('fills null preview fields with defaults', () => {
    const preview = withPreviewDefaults(
      { itemId: 'clip-1', leftNeighborId: null },
      { leftNeighborId: 'left-clip' },
    )

    expect(preview).toEqual({ itemId: 'clip-1', leftNeighborId: 'left-clip' })
  })

  it('preserves explicit false and zero preview values', () => {
    const preview = withPreviewDefaults(
      { neighborDelta: 0, constrained: false },
      { neighborDelta: 10, constrained: true },
    )

    expect(preview).toEqual({ neighborDelta: 0, constrained: false })
  })
})
